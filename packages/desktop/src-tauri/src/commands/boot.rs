// `mt::boot-info` — the one-shot startup handshake the renderer reads to learn
// its platform, key paths and capabilities. In the Electron build this was a
// synchronous `ipcRenderer.sendSync`; under Tauri the bridge shim awaits this
// command once before mounting Vue.

use serde::Serialize;
use std::collections::HashMap;
use tauri::Manager;

#[derive(Serialize)]
pub struct BootPaths {
    resources: String,
    user_data: String,
    cwd: String,
    ripgrep_binary: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitialFile {
    markdown: String,
    filename: String,
    pathname: String,
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
    /// File to open on launch, taken from the CLI argument / file association.
    initial_file: Option<InitialFile>,
    /// OS UI language resolved to an available locale (e.g. "zh-CN"), so the
    /// renderer loads the matching translations.
    locale: String,
}

/// Scan the process arguments for a readable file to open on launch (CLI use:
/// `marktext-light path/to/file.md`, and Windows/Linux file associations, which
/// also pass the path as an argument).
fn initial_file_from_args() -> Option<InitialFile> {
    for arg in std::env::args().skip(1) {
        if arg.starts_with('-') {
            continue;
        }
        let path = std::path::Path::new(&arg);
        if !path.is_file() {
            continue;
        }
        if let Ok(markdown) = std::fs::read_to_string(path) {
            let filename = path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            return Some(InitialFile {
                markdown,
                filename,
                pathname: path.to_string_lossy().into_owned(),
            });
        }
    }
    None
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
        initial_file: initial_file_from_args(),
        locale: crate::menu::i18n::resolve_locale().to_string(),
    })
}
