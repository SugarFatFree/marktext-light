// The subset of glob syntax the exclusion preferences use.
//
// Upstream matched with `minimatch(pathname, pattern, { matchBase: true })`,
// which is the rule reproduced here: a pattern with no separator matches a
// path's final component, and one with a separator matches the whole path.
// Supported wildcards are `*`, `**` and `?` — not character classes, brace
// expansion or negation. Matching is case-sensitive, as minimatch is without
// `nocase`; the expected results below were taken from minimatch itself rather
// than assumed.

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
    let mut pattern = String::from("^");
    let mut chars = glob.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '*' => {
                if chars.peek() == Some(&'*') {
                    chars.next();
                    // Swallow a following separator so a leading `**/` is
                    // optional: minimatch matches `foo` against `**/foo`.
                    // It does not make `docs/**` match `docs` — the separator
                    // before `**` is already in the pattern by then, and
                    // minimatch does not match that either.
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

#[cfg(test)]
mod tests {
    use super::*;

    // Every expectation here was checked against
    // `minimatch(path, pattern, { matchBase: true })`, the implementation the
    // Electron build used, rather than reasoned about.
    fn excluded(patterns: &[&str], path: &str) -> bool {
        let owned: Vec<String> = patterns.iter().map(|p| p.to_string()).collect();
        is_excluded(Path::new(path), &compile(&owned))
    }

    #[test]
    fn a_pattern_without_a_separator_tests_the_name() {
        assert!(excluded(&["*.tmp"], "/project/deep/notes.tmp"));
        assert!(excluded(&["draft.md"], "/project/draft.md"));
        assert!(excluded(&["sub"], "/project/sub"));
        assert!(!excluded(&["*.tmp"], "/project/notes.md"));
        // `sub` names a component, so it does not stand in for the path to one.
        assert!(!excluded(&["sub"], "/project/sub/x.md"));
    }

    #[test]
    fn a_pattern_with_a_separator_tests_the_whole_path() {
        assert!(excluded(&["/project/build/**"], "/project/build/out.md"));
        assert!(!excluded(&["/project/build/**"], "/other/build2/out.md"));
        // Not anchored at the root, so it matches nothing absolute.
        assert!(!excluded(&["sub/**"], "/project/sub/x.md"));
    }

    #[test]
    fn a_leading_double_star_is_optional() {
        assert!(excluded(&["**/foo"], "/a/b/foo"));
        assert!(excluded(&["**/foo"], "foo"));
    }

    #[test]
    fn a_single_star_stops_at_a_separator() {
        assert!(excluded(&["/project/*.md"], "/project/notes.md"));
        assert!(!excluded(&["/project/*.md"], "/project/deep/notes.md"));
    }

    #[test]
    fn a_trailing_double_star_does_not_match_the_directory_itself() {
        assert!(excluded(&["/project/docs/**"], "/project/docs/a/b.md"));
        // minimatch says false here; it wants something under `docs`.
        assert!(!excluded(&["/project/docs/**"], "/project/docs"));
    }

    #[test]
    fn question_mark_matches_one_character() {
        assert!(excluded(&["note?.md"], "/project/note1.md"));
        assert!(!excluded(&["note?.md"], "/project/note12.md"));
    }

    #[test]
    fn matching_is_case_sensitive() {
        // minimatch without `nocase`, which is how upstream called it.
        assert!(!excluded(&["*.TMP"], "/project/notes.tmp"));
        assert!(excluded(&["*.tmp"], "/project/notes.tmp"));
    }

    #[test]
    fn an_empty_or_unparseable_list_excludes_nothing() {
        assert!(!excluded(&[], "/project/notes.md"));
        assert!(!excluded(&["   "], "/project/notes.md"));
    }

    #[test]
    fn regex_metacharacters_stay_literal() {
        assert!(excluded(&["a.md"], "/project/a.md"));
        assert!(!excluded(&["a.md"], "/project/axmd"));
        assert!(excluded(&["a+b.md"], "/project/a+b.md"));
        assert!(excluded(&["a-b.md"], "/project/a-b.md"));
    }
}
