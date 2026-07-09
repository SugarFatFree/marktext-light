// `mt::cmd::exists` — probes whether an external tool (pandoc, etc.) is on PATH.

use std::path::Path;

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
