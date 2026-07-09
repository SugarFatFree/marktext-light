// Path-oriented commands — `mt::paths::is-image` and the case-insensitive
// fallback behind `mt::paths::is-same-sync`.

use std::path::Path;

const IMAGE_EXTENSIONS: [&str; 7] = ["jpeg", "jpg", "png", "gif", "svg", "webp", "bmp"];

#[tauri::command]
pub fn is_image(path: String) -> bool {
    let p = Path::new(&path);
    if !p.is_file() {
        return false;
    }
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| IMAGE_EXTENSIONS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Case-insensitive path equality fallback. The bridge shim only reaches here
/// when a cheap case-sensitive compare already failed, matching the old
/// preload behaviour (see `isSamePathSync`).
#[tauri::command]
pub fn is_same_path(a: String, b: String) -> bool {
    a.eq_ignore_ascii_case(&b)
}
