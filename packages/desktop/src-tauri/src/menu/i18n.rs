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

/// Loaded translation tree plus an English fallback and a dotted-key resolver.
pub struct Translations {
    tree: Value,
    fallback: Value,
}

impl Translations {
    /// Resolve `menu.section.key` against the active locale, then the English
    /// fallback, then the last path segment — so a missing translation degrades
    /// to readable text rather than empty. A leading `&` mnemonic marker (as in
    /// en's `&Theme`) is stripped.
    pub fn t(&self, key: &str) -> String {
        lookup(&self.tree, key)
            .or_else(|| lookup(&self.fallback, key))
            .map(|s| strip_mnemonic(&s))
            .unwrap_or_else(|| key.rsplit('.').next().unwrap_or(key).to_string())
    }
}

/// Remove a Windows access-key mnemonic: the CJK form `主题(&T)` or the Latin
/// form `&Theme`.
fn strip_mnemonic(s: &str) -> String {
    let mut out = s.to_string();
    if let Some(start) = out.find("(&") {
        if let Some(rel_end) = out[start..].find(')') {
            out.replace_range(start..start + rel_end + 1, "");
        }
    }
    out.replace('&', "")
}

fn lookup(tree: &Value, key: &str) -> Option<String> {
    let mut node = tree;
    for part in key.split('.') {
        node = node.get(part)?;
    }
    node.as_str().map(|s| s.to_string())
}

pub fn resolve_locale() -> &'static str {
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
    let fallback = read_locale(app, "en").unwrap_or(Value::Null);
    let tree = read_locale(app, locale).unwrap_or_else(|| fallback.clone());
    Translations { tree, fallback }
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
