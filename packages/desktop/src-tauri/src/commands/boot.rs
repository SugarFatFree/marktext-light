// `mt::boot-info` — the one-shot startup handshake the renderer reads to learn
// its platform, key paths and capabilities. In the Electron build this was a
// synchronous `ipcRenderer.sendSync`; under Tauri the bridge shim awaits this
// command once before mounting Vue.

use serde::Serialize;
use std::collections::HashMap;
use tauri::Manager;

use super::markdown::MarkdownDocument;

#[derive(Serialize)]
pub struct BootPaths {
    resources: String,
    user_data: String,
    cwd: String,
    ripgrep_binary: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootInfo {
    // Node-style values so existing renderer checks (`platform === 'darwin'`)
    // keep working without change.
    platform: String,
    arch: String,
    versions: HashMap<String, String>,
    env: HashMap<String, String>,
    paths: BootPaths,
    is_updatable: bool,
    #[serde(rename = "MARKDOWN_INCLUSIONS")]
    markdown_inclusions: Vec<String>,
    /// Files to open on launch, taken from CLI arguments / file associations.
    initial_files: Vec<MarkdownDocument>,
    /// OS UI language resolved to an available locale (e.g. "zh-CN"), so the
    /// renderer loads the matching translations.
    locale: String,
}

/// Scan the process arguments for a readable file to open on launch (CLI use:
/// `marktext-light path/to/file.md`, and Windows/Linux file associations, which
/// also pass the path as an argument).
fn initial_files_from_args() -> Vec<MarkdownDocument> {
    file_from_args(std::env::args().skip(1))
}

/// The argument scan itself, over an arbitrary argument list. A second launch
/// is funnelled into the running instance rather than starting a new process,
/// so the single-instance handler needs to run this over *that* process's argv
/// (already stripped of argv[0]) instead of this one's.
pub fn file_from_args(args: impl Iterator<Item = String>) -> Vec<MarkdownDocument> {
    args.filter(|arg| !arg.starts_with('-'))
        .filter_map(|arg| {
            let path = std::path::Path::new(&arg);
            if !path.is_file() {
                return None
            }
            // Use the same decoder as normal file opens so CLI and file-association
            // launches support BOMs and legacy encodings too.
            super::markdown::load_markdown(&arg, "lf", false).ok()
        })
        .collect()
}

const MARKDOWN_EXTENSIONS: [&str; 11] = [
    "markdown", "mdown", "mkdn", "md", "mkd", "mdwn", "mdtxt", "mdtext", "mdx", "text", "txt",
];

fn node_platform() -> String {
    match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        other => other,
    }
    .to_string()
}

fn node_arch() -> String {
    match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        other => other,
    }
    .to_string()
}

/// Return the bundled translation JSON for `lang` so the renderer's i18n can
/// load non-English locales (the Electron path went through main via IPC).
#[tauri::command]
pub fn load_locale(app: tauri::AppHandle, lang: String) -> Option<serde_json::Value> {
    let path = app
        .path()
        .resource_dir()
        .ok()?
        .join("locales")
        .join(format!("{lang}.json"));
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

#[tauri::command]
pub fn boot_info(app: tauri::AppHandle) -> Result<BootInfo, String> {
    // The renderer's first call into the shell: everything before this is
    // process spawn, plugin setup and WebView creation.
    crate::startup::trace("boot_info: entered");

    let resolver = app.path();

    let resources = resolver
        .resource_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    let user_data = resolver
        .app_data_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    let cwd = std::env::current_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();

    let mut versions = HashMap::new();
    versions.insert("tauri".to_string(), env!("CARGO_PKG_VERSION").to_string());

    Ok(BootInfo {
        platform: node_platform(),
        arch: node_arch(),
        versions,
        // The renderer only reads a handful of env vars; forward the full set
        // for parity and let callers pick what they need.
        env: std::env::vars().collect(),
        paths: BootPaths {
            resources,
            user_data,
            cwd,
            // Wired in phase 6 when ripgrep search moves to a sidecar/crate.
            ripgrep_binary: String::new(),
        },
        // Auto-update lands in phase 7 (tauri-plugin-updater).
        is_updatable: false,
        markdown_inclusions: MARKDOWN_EXTENSIONS.iter().map(|s| s.to_string()).collect(),
        initial_files: {
            // File contents ride along with this one round trip, so the renderer
            // never makes a second call for CLI or file-association launches.
            let files = initial_files_from_args();
            crate::startup::trace("boot_info: initial files read");
            files
        },
        locale: crate::menu::i18n::resolve_locale().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn temp_path(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "marktext-light-boot-{label}-{}",
            std::process::id()
        ))
    }

    #[test]
    fn loads_all_readable_startup_files() {
        let first = temp_path("first.md");
        let second = temp_path("second.md");
        fs::write(&first, b"# First\n").unwrap();
        fs::write(&second, b"# Second\n").unwrap();

        let files = file_from_args(vec![
            first.to_string_lossy().into_owned(),
            second.to_string_lossy().into_owned(),
        ]
        .into_iter());

        assert_eq!(files.len(), 2);
        assert_eq!(files[0].markdown, "# First\n");
        assert_eq!(files[1].markdown, "# Second\n");
        let _ = fs::remove_file(first);
        let _ = fs::remove_file(second);
    }

    #[test]
    fn startup_loader_strips_utf8_bom() {
        let path = temp_path("bom.md");
        fs::write(&path, [0xef, 0xbb, 0xbf, b'#', b' ', b'T', b'\n']).unwrap();

        let files = file_from_args(vec![path.to_string_lossy().into_owned()].into_iter());

        assert_eq!(files.len(), 1);
        assert_eq!(files[0].markdown, "# T\n");
        assert!(files[0].encoding.is_bom);
        let _ = fs::remove_file(path);
    }
}
