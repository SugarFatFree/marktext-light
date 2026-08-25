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
//   - Exclusion patterns cover `*`, `**` and `?` (see commands/glob.rs), not
//     the character classes and brace expansion minimatch also accepts.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter};

use super::glob::{self, Exclusion};

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
    // `checked_mul`, not `*`: a release build wraps on overflow, so a huge value
    // would come back as a tiny limit and exclude every file instead of none.
    digits.parse::<u64>().ok().and_then(|n| n.checked_mul(scale))
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
    exclusions: &'a [Exclusion],
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
                    || glob::is_excluded(&path, self.exclusions)
                {
                    continue;
                }
                if !self.walk(&path, depth + 1) {
                    return false;
                }
                continue;
            }

            if !meta.is_file()
                || glob::is_excluded(&path, self.exclusions)
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
        let exclusions = glob::compile(&req.options.exclusions);
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

#[cfg(test)]
mod tests {
    use super::*;

    fn options(pattern_is_regexp: bool, whole_word: bool, case_sensitive: bool) -> SearchOptions {
        SearchOptions {
            is_regexp: pattern_is_regexp,
            is_whole_word: whole_word,
            is_case_sensitive: case_sensitive,
            ..Default::default()
        }
    }

    #[test]
    fn file_size_suffixes_scale() {
        assert_eq!(parse_max_file_size(&Some("512".into())), Some(512));
        assert_eq!(parse_max_file_size(&Some("2K".into())), Some(2 * 1024));
        assert_eq!(parse_max_file_size(&Some("3M".into())), Some(3 * 1024 * 1024));
        assert_eq!(parse_max_file_size(&Some("1G".into())), Some(1024 * 1024 * 1024));
        // The settings schema writes uppercase; accepting either costs nothing.
        assert_eq!(parse_max_file_size(&Some("2k".into())), Some(2 * 1024));
    }

    #[test]
    fn an_absent_or_unusable_size_means_no_limit() {
        assert_eq!(parse_max_file_size(&None), None);
        assert_eq!(parse_max_file_size(&Some("".into())), None);
        assert_eq!(parse_max_file_size(&Some("   ".into())), None);
        assert_eq!(parse_max_file_size(&Some("big".into())), None);
        // Overflowing must read as "no limit", never as a very small one.
        assert_eq!(parse_max_file_size(&Some("18446744073709551G".into())), None);
    }

    #[test]
    fn a_plain_search_treats_the_pattern_literally() {
        let matcher = build_matcher("a.c", &options(false, false, true)).unwrap();
        assert!(matcher.is_match("a.c"));
        assert!(!matcher.is_match("abc"));
    }

    #[test]
    fn a_regexp_search_does_not() {
        let matcher = build_matcher("a.c", &options(true, false, true)).unwrap();
        assert!(matcher.is_match("abc"));
    }

    #[test]
    fn whole_word_needs_a_boundary() {
        let matcher = build_matcher("cat", &options(false, true, true)).unwrap();
        assert!(matcher.is_match("a cat sat"));
        assert!(!matcher.is_match("concatenate"));
    }

    #[test]
    fn case_sensitivity_is_the_caller_s_choice() {
        assert!(build_matcher("Cat", &options(false, false, false))
            .unwrap()
            .is_match("cat"));
        assert!(!build_matcher("Cat", &options(false, false, true))
            .unwrap()
            .is_match("cat"));
    }

    #[test]
    fn an_invalid_regexp_is_reported_rather_than_panicking() {
        assert!(build_matcher("(unclosed", &options(true, false, true)).is_err());
    }

    #[test]
    fn match_positions_are_counted_in_characters() {
        // The renderer indexes into a JS string to highlight the hit, so a byte
        // offset would land in the wrong place after any non-ASCII text.
        let matcher = build_matcher("cat", &options(false, false, true)).unwrap();
        let found = matches_in("日本語 cat here", &matcher);

        assert_eq!(found.len(), 1);
        assert_eq!(found[0].range, [[0, 4], [0, 7]]);
    }

    #[test]
    fn every_line_and_every_hit_is_reported() {
        let matcher = build_matcher("x", &options(false, false, true)).unwrap();
        let found = matches_in("x\nno\nx x", &matcher);

        assert_eq!(found.len(), 3);
        assert_eq!(found[0].range[0][0], 0);
        assert_eq!(found[1].range[0][0], 2);
        assert_eq!(found[2].range, [[2, 2], [2, 3]]);
    }

    #[test]
    fn inclusions_filter_by_extension() {
        let markdown = vec!["md".to_string(), "txt".to_string()];
        assert!(has_included_extension("notes.md", &markdown));
        assert!(has_included_extension("NOTES.MD", &markdown));
        assert!(!has_included_extension("image.png", &markdown));
        // An empty list means every readable file.
        assert!(has_included_extension("image.png", &[]));
    }
}
