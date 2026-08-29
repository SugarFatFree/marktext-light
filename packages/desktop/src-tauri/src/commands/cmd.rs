// `mt::cmd::exists` — probes whether an external tool (pandoc, etc.) is on PATH,
// plus the one external tool this app actually runs.

use std::path::Path;
use std::process::Command;

#[tauri::command]
pub fn command_exists(name: String) -> bool {
    // Absolute/relative paths: check directly.
    if name.contains('/') || name.contains('\\') {
        return Path::new(&name).is_file();
    }
    let path_var = match std::env::var_os("PATH") {
        Some(p) => p,
        None => return false,
    };
    let exts: Vec<String> = if cfg!(windows) {
        std::env::var("PATHEXT")
            .unwrap_or_else(|_| ".EXE;.CMD;.BAT;.COM".into())
            .split(';')
            .map(|s| s.to_string())
            .collect()
    } else {
        vec![String::new()]
    };
    for dir in std::env::split_paths(&path_var) {
        for ext in &exts {
            let candidate = dir.join(format!("{name}{ext}"));
            if candidate.is_file() {
                return true;
            }
        }
    }
    false
}


/// Convert a document to markdown with pandoc.
///
/// Deliberately not a general "run a command" command: the program is fixed and
/// the only caller-supplied value is a path, so nothing here can be turned into
/// arbitrary execution. Mirrors what the Electron build ran —
/// `pandoc -s <file> -t markdown`.
#[tauri::command]
pub fn pandoc_to_markdown(path: String) -> Result<String, String> {
    if !Path::new(&path).is_file() {
        return Err(format!("Not a file: {path}"));
    }

    let output = Command::new("pandoc")
        .args(["-s", &path, "-t", "markdown"])
        .output()
        .map_err(|e| format!("Cannot run pandoc: {e}"))?;

    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr);
        return Err(if message.trim().is_empty() {
            "pandoc failed".to_string()
        } else {
            message.trim().to_string()
        });
    }

    String::from_utf8(output.stdout).map_err(|e| e.to_string())
}
