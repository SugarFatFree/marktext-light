// Project-wide search, in place of the bundled ripgrep binary the Electron
// build shelled out to (src/main/ripgrep).
//
// Tauri ships no such binary, so the walk and the matching happen here. The
// event contract is unchanged — `mt::rg::match` / `-progress` / `-done` /
// `-error` / `-cancelled`, each carrying the `searchId` the renderer filters
// on — so `renderer/src/node/ripgrepSearcher.ts` and its callers are untouched.
//
// Two deliberate gaps against real ripgrep, both surfaced here rather than
// pretended away:
//   - `.gitignore` is not read. `node_modules`, `.git` and (unless asked for)
//     dot-entries are skipped, which covers what the sidebar search needs.
//   - Exclusion patterns support `*`, `**` and `?`, not the full glob syntax.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter};

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SearchOptions {
    is_case_sensitive: bool,
    is_whole_word: bool,
    is_regexp: bool,
    exclusions: Vec<String>,
    /// `<number><K|M|G>` or plain bytes; empty means no limit.
    max_file_size: Option<String>,
    include_hidden: bool,
    follow_symlinks: bool,
    /// File extensions to search; empty means every readable text file.
    inclusions: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRequest {
    search_id: String,
    /// `text` reports matching lines, `files` reports paths only (quick open).
    mode: String,
    directories: Vec<String>,
    pattern: String,
    #[serde(default)]
    options: SearchOptions,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Match {
    line_text: String,
    /// `[[startLine, startCh], [endLine, endCh]]`, as the sidebar expects.
    range: [[usize; 2]; 2],
}

/// Searches currently running, and whether each has been asked to stop.
///
/// One map rather than a set of cancelled ids: a cancel can arrive just after a
/// search finished — the renderer cancels both on its match-count limit and in
/// its error path, either of which can race completion — and a set would then
/// keep an id nothing will ever remove.
fn searches() -> &'static Mutex<HashMap<String, bool>> {
    static SEARCHES: OnceLock<Mutex<HashMap<String, bool>>> = OnceLock::new();
    SEARCHES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn is_cancelled(search_id: &str) -> bool {
    searches()
        .lock()
        .map(|map| map.get(search_id).copied().unwrap_or(false))
        .unwrap_or(false)
}

/// Directories never worth walking, whatever the options say.
const ALWAYS_SKIPPED: [&str; 2] = ["node_modules", ".git"];

fn parse_max_file_size(raw: &Option<String>) -> Option<u64> {
    let text = raw.as_deref()?.trim();
    if text.is_empty() {
        return None;
    }
    let (digits, scale) = match text.chars().last()? {
        'K' | 'k' => (&text[..text.len() - 1], 1024),
        'M' | 'm' => (&text[..text.len() - 1], 1024 * 1024),
        'G' | 'g' => (&text[..text.len() - 1], 1024 * 1024 * 1024),
        _ => (text, 1),
    };
    digits.parse::<u64>().ok().map(|n| n * scale)
}

/// Translate the subset of glob syntax the exclusion list uses into a regex.
fn glob_to_regex(glob: &str) -> Option<Regex> {
    let mut pattern = String::from("(?i)^");
    let mut chars = glob.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '*' => {
                if chars.peek() == Some(&'*') {
                    chars.next();
                    pattern.push_str(".*");
                } else {
                    pattern.push_str("[^/\\\\]*");
                }
            }
            '?' => pattern.push('.'),
            other => pattern.push_str(&regex::escape(&other.to_string())),
        }
    }
    pattern.push('$');
    Regex::new(&pattern).ok()
}

fn build_matcher(pattern: &str, options: &SearchOptions) -> Result<Regex, String> {
    let body = if options.is_regexp {
        pattern.to_string()
    } else {
        regex::escape(pattern)
    };
    let body = if options.is_whole_word {
        format!(r"\b(?:{body})\b")
    } else {
        body
    };
    let source = if options.is_case_sensitive {
        body
    } else {
        format!("(?i){body}")
    };
    Regex::new(&source).map_err(|e| e.to_string())
}

fn has_included_extension(name: &str, inclusions: &[String]) -> bool {
    if inclusions.is_empty() {
        return true;
    }
    let lower = name.to_ascii_lowercase();
    inclusions
        .iter()
        .any(|ext| lower.ends_with(&format!(".{}", ext.trim_start_matches('.').to_ascii_lowercase())))
}

fn is_excluded(path: &Path, name: &str, exclusions: &[Regex]) -> bool {
    let full = path.to_string_lossy();
    exclusions
        .iter()
        .any(|rule| rule.is_match(name) || rule.is_match(&full))
}

/// Every line of `content` that matches, as the renderer's `SearchMatch` shape.
fn matches_in(content: &str, matcher: &Regex) -> Vec<Match> {
    let mut found = Vec::new();
    for (line_index, line) in content.lines().enumerate() {
        for hit in matcher.find_iter(line) {
            // Character offsets, not byte offsets: the renderer indexes into a
            // JS string to highlight the hit.
            let start = line[..hit.start()].chars().count();
            let end = start + hit.as_str().chars().count();
            found.push(Match {
                line_text: line.to_string(),
                range: [[line_index, start], [line_index, end]],
            });
        }
    }
    found
}

struct Walker<'a> {
    app: &'a AppHandle,
    search_id: &'a str,
    files_mode: bool,
    matcher: &'a Regex,
    options: &'a SearchOptions,
    exclusions: &'a [Regex],
    max_bytes: Option<u64>,
    hits: usize,
}

impl Walker<'_> {
    fn emit(&self, event: &str, body: serde_json::Value) {
        if let Err(err) = self.app.emit(event, body) {
            eprintln!("[search] failed to emit {event}: {err}");
        }
    }

    /// Returns false once the search has been cancelled.
    fn walk(&mut self, dir: &Path, depth: usize) -> bool {
        if depth > 24 || is_cancelled(self.search_id) {
            return !is_cancelled(self.search_id);
        }
        let Ok(entries) = std::fs::read_dir(dir) else {
            return true;
        };

        for entry in entries.flatten() {
            if is_cancelled(self.search_id) {
                return false;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if !self.options.include_hidden && name.starts_with('.') {
                continue;
            }
            let path = entry.path();
            let Ok(meta) = (if self.options.follow_symlinks {
                std::fs::metadata(&path)
            } else {
                entry.metadata()
            }) else {
                continue;
            };

            if meta.is_dir() {
                if ALWAYS_SKIPPED.contains(&name.as_str())
                    || is_excluded(&path, &name, self.exclusions)
                {
                    continue;
                }
                if !self.walk(&path, depth + 1) {
                    return false;
                }
                continue;
            }

            if !meta.is_file()
                || is_excluded(&path, &name, self.exclusions)
                || !has_included_extension(&name, &self.options.inclusions)
            {
                continue;
            }
            if self.max_bytes.is_some_and(|limit| meta.len() > limit) {
                continue;
            }
            self.visit_file(&path);
        }
        true
    }

    fn visit_file(&mut self, path: &Path) {
        let file_path = path.to_string_lossy().into_owned();

        if self.files_mode {
            self.hits += 1;
            self.emit(
                "mt::rg::match",
                json!({ "searchId": self.search_id, "payload": file_path }),
            );
        } else {
            // Binary and non-UTF-8 files are simply not searchable here.
            let Ok(content) = std::fs::read_to_string(path) else {
                return;
            };
            let matches = matches_in(&content, self.matcher);
            if matches.is_empty() {
                return;
            }
            self.hits += 1;
            self.emit(
                "mt::rg::match",
                json!({
                    "searchId": self.search_id,
                    "payload": { "filePath": file_path, "matches": matches },
                }),
            );
        }

        // The renderer cancels past a threshold of matching files, so the
        // running count has to arrive as it grows.
        self.emit(
            "mt::rg::progress",
            json!({ "searchId": self.search_id, "num": self.hits }),
        );
    }
}

/// Start a search. Returns as soon as the walk is running; results arrive as
/// events, and the renderer's promise settles on `done` / `error` / `cancelled`.
#[tauri::command]
pub fn rg_start(app: AppHandle, req: SearchRequest) -> Result<(), String> {
    let matcher = build_matcher(&req.pattern, &req.options)?;

    // Registered before the thread starts: a cancel that arrives first would
    // otherwise find no entry to mark and the walk would run to completion.
    searches()
        .lock()
        .map_err(|e| e.to_string())?
        .insert(req.search_id.clone(), false);

    std::thread::spawn(move || {
        let exclusions: Vec<Regex> = req
            .options
            .exclusions
            .iter()
            .filter_map(|glob| glob_to_regex(glob))
            .collect();
        let max_bytes = parse_max_file_size(&req.options.max_file_size);
        let mut walker = Walker {
            app: &app,
            search_id: &req.search_id,
            files_mode: req.mode == "files",
            matcher: &matcher,
            options: &req.options,
            exclusions: &exclusions,
            max_bytes,
            hits: 0,
        };

        let mut completed = true;
        for directory in &req.directories {
            if !walker.walk(Path::new(directory), 0) {
                completed = false;
                break;
            }
        }

        let event = if completed {
            "mt::rg::done"
        } else {
            "mt::rg::cancelled"
        };
        walker.emit(event, json!({ "searchId": req.search_id }));

        if let Ok(mut map) = searches().lock() {
            map.remove(&req.search_id);
        }
    });

    Ok(())
}

/// Ask a running search to stop. A search that already finished is not
/// resurrected as a permanent entry — there is nothing left to cancel.
#[tauri::command]
pub fn rg_cancel(search_id: String) {
    if let Ok(mut map) = searches().lock() {
        if let Some(flag) = map.get_mut(&search_id) {
            *flag = true;
        }
    }
}
