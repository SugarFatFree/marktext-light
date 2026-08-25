// The subset of glob syntax the exclusion preferences use.
//
// Upstream matched with `minimatch(pathname, pattern, { matchBase: true })`,
// which is the rule reproduced here: a pattern with no separator matches a
// path's final component, and one with a separator matches the whole path.
// Supported wildcards are `*`, `**` and `?` — not character classes, brace
// expansion or negation.

use regex::Regex;
use std::path::Path;

/// A compiled exclusion, remembering whether it applies to the name or the path.
pub struct Exclusion {
    pattern: Regex,
    /// `minimatch`'s `matchBase`: patterns without a separator test the
    /// basename, so `*.tmp` excludes such a file wherever it sits.
    base_only: bool,
}

fn to_regex(glob: &str) -> Option<Regex> {
    let mut pattern = String::from("(?i)^");
    let mut chars = glob.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '*' => {
                if chars.peek() == Some(&'*') {
                    chars.next();
                    // Swallow a following separator so `docs/**` also matches
                    // `docs` itself, as minimatch does.
                    if matches!(chars.peek(), Some('/') | Some('\\')) {
                        chars.next();
                    }
                    pattern.push_str(".*");
                } else {
                    pattern.push_str("[^/\\\\]*");
                }
            }
            '?' => pattern.push('.'),
            '/' | '\\' => pattern.push_str("[/\\\\]"),
            other => pattern.push_str(&regex::escape(&other.to_string())),
        }
    }
    pattern.push('$');
    Regex::new(&pattern).ok()
}

/// Compile a list of glob patterns, dropping any that will not parse.
pub fn compile(patterns: &[String]) -> Vec<Exclusion> {
    patterns
        .iter()
        .filter(|glob| !glob.trim().is_empty())
        .filter_map(|glob| {
            to_regex(glob).map(|pattern| Exclusion {
                pattern,
                base_only: !glob.contains('/') && !glob.contains('\\'),
            })
        })
        .collect()
}

pub fn is_excluded(path: &Path, exclusions: &[Exclusion]) -> bool {
    if exclusions.is_empty() {
        return false;
    }
    let full = path.to_string_lossy();
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();

    exclusions.iter().any(|exclusion| {
        if exclusion.base_only {
            exclusion.pattern.is_match(&name)
        } else {
            exclusion.pattern.is_match(&full)
        }
    })
}
