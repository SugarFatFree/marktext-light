// Menu localization. Loads MarkText's bundled locale JSON (static/locales,
// shipped as a Tauri resource under `locales/`) for the OS UI language and looks
// up dotted keys like `menu.edit.undo`, mirroring the renderer's `t()` helper.
//
// Language source (phase 2): the OS locale via `sys-locale`. Once Tauri
// preferences land (phase 5) the user's explicit language choice should win.

use serde_json::Value;
use tauri::{AppHandle, Manager, Runtime};

// Locale files present in static/locales. An OS locale is matched exactly, then
// by language prefix, else falls back to English.
const AVAILABLE: [&str; 10] = [
    "de", "en", "es", "fr", "ja", "ko", "pt", "tr", "zh-CN", "zh-TW",
];

/// Loaded translation tree plus a resolver for dotted keys.
pub struct Translations {
    tree: Value,
}

impl Translations {
    /// Resolve `menu.section.key`; returns the last path segment if missing so a
    /// missing translation degrades to a readable label rather than empty text.
    pub fn t(&self, key: &str) -> String {
        let mut node = &self.tree;
        for part in key.split('.') {
            node = &node[part];
        }
        node.as_str()
            .map(|s| s.to_string())
            .unwrap_or_else(|| key.rsplit('.').next().unwrap_or(key).to_string())
    }
}

fn resolve_locale() -> &'static str {
    let raw = sys_locale::get_locale().unwrap_or_default();
    // Exact match (e.g. "zh-CN").
    if let Some(hit) = AVAILABLE.iter().find(|l| raw.eq_ignore_ascii_case(l)) {
        return hit;
    }
    // Language-prefix match (e.g. "de-AT" -> "de", "zh-Hans" -> "zh-CN").
    let lang = raw.split(['-', '_']).next().unwrap_or("").to_lowercase();
    if lang == "zh" {
        return "zh-CN";
    }
    AVAILABLE
        .iter()
        .find(|l| l.split('-').next().unwrap_or("").eq_ignore_ascii_case(&lang))
        .copied()
        .unwrap_or("en")
}

pub fn load<R: Runtime>(app: &AppHandle<R>) -> Translations {
    let locale = resolve_locale();
    let tree = read_locale(app, locale)
        .or_else(|| read_locale(app, "en"))
        .unwrap_or(Value::Null);
    Translations { tree }
}

fn read_locale<R: Runtime>(app: &AppHandle<R>, locale: &str) -> Option<Value> {
    let path = app
        .path()
        .resource_dir()
        .ok()?
        .join("locales")
        .join(format!("{locale}.json"));
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}
