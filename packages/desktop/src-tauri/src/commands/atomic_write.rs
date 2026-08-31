// Writing a file so that a crash cannot destroy the previous one.
//
// `fs::write` truncates the target and then writes into it. Between those two
// steps the file on disk is empty, and after them its contents may still be in
// the OS page cache rather than on the platter. A crash in the first window
// leaves a truncated document; a power loss in the second leaves a
// full-length, zero-filled one — which is worse, because it looks like a file.
//
// Upstream hit both. `main/filesystem/index.ts` reaches for `write-file-atomic`
// and its comment names the two issues that put it there (#3786, #3828), plus
// a third (#3509) for a save into a folder that has since been deleted. This is
// the same procedure in Rust: write a uniquely-named temp file beside the
// target, flush it to the device, then rename it over the target. A rename is
// atomic within a filesystem, so a reader either sees the whole old file or the
// whole new one, never a half of either.
//
// The temp file has to live in the target's own directory: `rename` across
// filesystems fails, and the system temp directory is very often a different
// one.

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// Distinguishes two saves inside the same millisecond in the same process.
static COUNTER: AtomicU64 = AtomicU64::new(0);

fn temp_path(target: &Path) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let name = target
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file".to_string());

    // Leading dot so a half-written save does not show up in the sidebar tree
    // if the process dies before the rename.
    target.with_file_name(format!(".{name}.{nanos}.{n}.tmp"))
}

/// Follow a symlink to whatever it points at, so the link is preserved and its
/// target is what gets replaced. `canonicalize` needs the path to exist; for a
/// new file there is nothing to resolve and the path stands as given.
fn resolve(path: &Path) -> PathBuf {
    fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

#[cfg(unix)]
fn copy_permissions(from: &Path, to: &File) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    // Only when the target already exists: a new file keeps the umask default,
    // which is what creating it any other way would have given it too.
    if let Ok(meta) = fs::metadata(from) {
        to.set_permissions(fs::Permissions::from_mode(meta.permissions().mode()))?;
    }
    Ok(())
}

#[cfg(not(unix))]
fn copy_permissions(_from: &Path, _to: &File) -> std::io::Result<()> {
    Ok(())
}

/// Flush the directory entry itself, so the rename survives a power loss and
/// not just a process crash. Not available on Windows, where the file's own
/// flush is as far as this goes.
#[cfg(unix)]
fn sync_dir(dir: &Path) {
    // Best effort: on a filesystem that refuses to open a directory this is not
    // a reason to fail a save that has otherwise succeeded.
    if let Ok(handle) = File::open(dir) {
        let _ = handle.sync_all();
    }
}

#[cfg(not(unix))]
fn sync_dir(_dir: &Path) {}

/// Write `data` to `path`, atomically and durably.
///
/// Missing parent directories are created: a folder deleted or moved while a
/// document was open should not turn the next save into an error (#3509).
pub fn write_atomic(path: &Path, data: &[u8]) -> std::io::Result<()> {
    let target = resolve(path);
    let dir = target.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(dir)?;

    let temp = temp_path(&target);
    // The write, the permission copy and the flush all have to succeed before
    // anything replaces the target; if any fails, the temp file is removed and
    // the old document is still exactly where it was.
    let result = (|| -> std::io::Result<()> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        copy_permissions(&target, &file)?;
        file.write_all(data)?;
        // Before the rename, not after: this is the step that closes the
        // power-loss window a bare rename leaves open.
        file.sync_all()?;
        drop(file);
        fs::rename(&temp, &target)
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temp);
        return result;
    }

    sync_dir(dir);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mt-atomic-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Anything left beside the target — a temp file the writer failed to clean
    /// up would show up here.
    fn entries(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn writes_the_content() {
        let dir = scratch("basic");
        let file = dir.join("a.md");

        write_atomic(&file, b"# Hello\n").unwrap();

        assert_eq!(fs::read(&file).unwrap(), b"# Hello\n");
    }

    #[test]
    fn replaces_an_existing_file_completely() {
        let dir = scratch("replace");
        let file = dir.join("a.md");
        fs::write(&file, b"a much longer previous version of the document").unwrap();

        write_atomic(&file, b"short\n").unwrap();

        // Not a partial overwrite leaving the tail of the old content behind.
        assert_eq!(fs::read(&file).unwrap(), b"short\n");
    }

    #[test]
    fn leaves_no_temp_file_behind() {
        let dir = scratch("clean");
        let file = dir.join("a.md");

        write_atomic(&file, b"one").unwrap();
        write_atomic(&file, b"two").unwrap();

        assert_eq!(entries(&dir), vec!["a.md".to_string()]);
    }

    #[test]
    fn creates_a_parent_directory_that_went_missing() {
        // #3509: the folder holding an open document is deleted or moved, and
        // the next save has nowhere to go.
        let dir = scratch("mkdir");
        let file = dir.join("gone").join("nested").join("a.md");

        write_atomic(&file, b"saved anyway\n").unwrap();

        assert_eq!(fs::read(&file).unwrap(), b"saved anyway\n");
    }

    #[test]
    fn two_writes_to_one_directory_do_not_collide() {
        // Temp names carry a counter as well as a timestamp, because saving two
        // tabs at once lands in the same millisecond.
        let dir = scratch("collide");
        write_atomic(&dir.join("a.md"), b"a").unwrap();
        write_atomic(&dir.join("b.md"), b"b").unwrap();

        assert_eq!(fs::read(dir.join("a.md")).unwrap(), b"a");
        assert_eq!(fs::read(dir.join("b.md")).unwrap(), b"b");
        assert_eq!(entries(&dir), vec!["a.md".to_string(), "b.md".to_string()]);
    }

    #[cfg(unix)]
    #[test]
    fn keeps_the_target_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let dir = scratch("mode");
        let file = dir.join("a.md");
        fs::write(&file, b"old").unwrap();
        fs::set_permissions(&file, fs::Permissions::from_mode(0o640)).unwrap();

        write_atomic(&file, b"new").unwrap();

        let mode = fs::metadata(&file).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o640, "a save must not widen or narrow the file's mode");
    }

    #[cfg(unix)]
    #[test]
    fn writes_through_a_symlink_to_its_target() {
        // A document reached through a link — a dotfile in a checked-out
        // config repository, say. Replacing the link with a regular file would
        // silently detach it from whatever it pointed at.
        let dir = scratch("symlink");
        let real = dir.join("real.md");
        let link = dir.join("link.md");
        fs::write(&real, b"old").unwrap();
        std::os::unix::fs::symlink(&real, &link).unwrap();

        write_atomic(&link, b"new").unwrap();

        assert_eq!(fs::read(&real).unwrap(), b"new");
        assert!(
            fs::symlink_metadata(&link).unwrap().file_type().is_symlink(),
            "the link itself must survive the save"
        );
    }
}
