// Filesystem commands — Rust re-implementation of the `mt::fs::*` IPC channels
// that the Electron main process used to serve from Node's `fs-extra`.
//
// Signatures mirror `fileUtils.*` in the old preload bridge so the renderer's
// call sites stay unchanged. Errors are surfaced as `Result<_, String>`; the
// bridge shim rejects the corresponding Promise with that message.

use serde::Serialize;
use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

/// Result of `read_file`. Text encodings deserialize to a JS string; when no
/// (or a binary) encoding is requested the renderer receives a byte array it
/// wraps in a `Uint8Array`, matching the old `string | Uint8Array` return.
#[derive(Serialize)]
#[serde(untagged)]
pub enum FileData {
    Text(String),
    Binary(Vec<u8>),
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SerializedStat {
    size: f64,
    mtime_ms: f64,
    is_file: bool,
    is_directory: bool,
    is_symbolic_link: bool,
}

#[tauri::command]
pub fn is_file(path: String) -> bool {
    Path::new(&path).is_file()
}

#[tauri::command]
pub fn is_directory(path: String) -> bool {
    Path::new(&path).is_dir()
}

#[tauri::command]
pub fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
pub fn is_executable(path: String) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::metadata(&path)
            .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        // On Windows executability is by extension; treat existence as enough
        // for the callers that probe for tools like pandoc.
        Path::new(&path).is_file()
    }
}

#[tauri::command]
pub fn read_file(path: String, encoding: Option<String>) -> Result<FileData, String> {
    match encoding.as_deref() {
        // The renderer passes 'utf8' / 'utf-8' for markdown; anything else
        // (or nothing) is treated as raw bytes.
        Some("utf8") | Some("utf-8") => {
            let bytes = fs::read(&path).map_err(|e| e.to_string())?;
            String::from_utf8(bytes)
                .map(FileData::Text)
                .map_err(|e| e.to_string())
        }
        _ => fs::read(&path)
            .map(FileData::Binary)
            .map_err(|e| e.to_string()),
    }
}

#[tauri::command]
pub fn write_file(path: String, data: FileWriteData) -> Result<(), String> {
    fs::write(&path, data.into_bytes()).map_err(|e| e.to_string())
}

/// `output-file` also creates any missing parent directories (fs-extra parity).
#[tauri::command]
pub fn output_file(path: String, data: FileWriteData) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, data.into_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ensure_dir(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn empty_dir(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.exists() {
        for entry in fs::read_dir(p).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let child = entry.path();
            if child.is_dir() {
                fs::remove_dir_all(&child).map_err(|e| e.to_string())?;
            } else {
                fs::remove_file(&child).map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    } else {
        fs::create_dir_all(p).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn copy_path(src: String, dest: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&dest).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::copy(&src, &dest).map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn move_path(src: String, dest: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&dest).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // `rename` fails across filesystems; fall back to copy + remove.
    match fs::rename(&src, &dest) {
        Ok(()) => Ok(()),
        Err(_) => {
            fs::copy(&src, &dest).map_err(|e| e.to_string())?;
            fs::remove_file(&src).map_err(|e| e.to_string())
        }
    }
}

#[tauri::command]
pub fn unlink(path: String) -> Result<(), String> {
    fs::remove_file(&path).map_err(|e| e.to_string())
}

/// Move a file or directory to the OS trash — the recoverable delete the
/// sidebar's context menu offers, and the counterpart of Electron's
/// `shell.trashItem`. Distinct from `unlink`, which deletes outright.
#[tauri::command]
pub fn trash_item(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn readdir(path: String) -> Result<Vec<String>, String> {
    let mut names = Vec::new();
    for entry in fs::read_dir(&path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        names.push(entry.file_name().to_string_lossy().into_owned());
    }
    Ok(names)
}

#[tauri::command]
pub fn stat(path: String) -> Result<SerializedStat, String> {
    let meta = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0);
    Ok(SerializedStat {
        size: meta.len() as f64,
        mtime_ms,
        is_file: meta.is_file(),
        is_directory: meta.is_dir(),
        is_symbolic_link: meta.file_type().is_symlink(),
    })
}

/// The renderer sends either a UTF-8 string or a byte array for writes. This
/// untagged enum accepts both so `writeFile`/`outputFile` keep their old shape.
#[derive(serde::Deserialize)]
#[serde(untagged)]
pub enum FileWriteData {
    Text(String),
    Binary(Vec<u8>),
}

impl FileWriteData {
    fn into_bytes(self) -> Vec<u8> {
        match self {
            FileWriteData::Text(s) => s.into_bytes(),
            FileWriteData::Binary(b) => b,
        }
    }
}
