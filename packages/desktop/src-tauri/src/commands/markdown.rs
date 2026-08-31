// Loading a markdown document from disk — the Rust counterpart of Electron's
// `main/filesystem/markdown.ts` + `main/filesystem/encoding.ts`.
//
// `read_file` is not enough for this. It decodes strict UTF-8, which means a
// file saved by Notepad (UTF-8 with a BOM) opens with U+FEFF as its first
// character — and a document that starts with `\u{feff}# Title` has no heading,
// it has a paragraph, verified against the engine's own lexer. Worse, that
// document round-trips to disk unchanged, so the damage outlives the session.
// A file in a legacy encoding — GBK, Big5, EUC-KR, Shift_JIS — does not open at
// all, and reports a decoder error the reader can do nothing with.
//
// Everything this returns already has a home on the renderer's tab state
// (`MarkdownDocument` in shared/types/files.ts): the encoding so the save path
// can refuse to silently transcode, the line ending so a CRLF file is written
// back as CRLF, the trailing-newline count so saving does not add or remove
// one behind the user's back. The Electron side filled all of it in; the Tauri
// bridge was passing a bare string.

use encoding_rs::{Encoding, UTF_16BE, UTF_16LE, UTF_8};
use serde::Serialize;
use std::fs;
use std::path::Path;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TextEncoding {
    /// iconv-lite's spelling, because the renderer's save path and the encoding
    /// menu were both written against it.
    pub encoding: String,
    /// Whether the file began with a byte-order mark. The mark is stripped from
    /// the text; this is what remembers to write it back.
    pub is_bom: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownDocument {
    pub markdown: String,
    pub filename: String,
    pub pathname: String,
    pub encoding: TextEncoding,
    /// "lf" or "crlf" — what the file used, not what is in `markdown`, which is
    /// always LF.
    pub line_ending: String,
    pub adjust_line_ending_on_save: bool,
    /// 0 = none, 1 = one, 2 = two or more, 3 = the file was empty. Mirrors the
    /// values the renderer's save path already understands.
    pub trim_trailing_newline: u8,
    pub is_mixed_line_endings: bool,
}

const BOM_UTF8: [u8; 3] = [0xef, 0xbb, 0xbf];
const BOM_UTF16BE: [u8; 2] = [0xfe, 0xff];
const BOM_UTF16LE: [u8; 2] = [0xff, 0xfe];

/// Decode a text file, stripping any byte-order mark.
///
/// Order matters and mirrors the Electron implementation, including the reason
/// it is in this order: a BOM is proof, so it wins; then valid UTF-8 is taken
/// as UTF-8 even when a statistical detector would prefer a legacy encoding,
/// because that misdetection is what turned Greek letters into CJK in #3151.
/// Only bytes that are not valid UTF-8 reach the detector.
/// `tld` biases the detector towards a region, which is what makes the
/// difference between GBK and EUC-KR on a short file: the two are not
/// distinguishable from the bytes alone, and a document with one line in it
/// gives a statistical detector almost nothing to work with. The hint comes
/// from the OS UI language — the same source the native menu is translated
/// from — on the reasoning that someone reading Simplified Chinese is far more
/// likely to open a GBK file than a Korean one.
pub fn decode_text(bytes: &[u8], tld: Option<&[u8]>) -> (String, TextEncoding) {
    if bytes.starts_with(&BOM_UTF8) {
        let (text, _, _) = UTF_8.decode(&bytes[BOM_UTF8.len()..]);
        return (text.into_owned(), enc("utf8", true));
    }
    if bytes.starts_with(&BOM_UTF16LE) {
        let (text, _, _) = UTF_16LE.decode(&bytes[BOM_UTF16LE.len()..]);
        return (text.into_owned(), enc("utf16le", true));
    }
    if bytes.starts_with(&BOM_UTF16BE) {
        let (text, _, _) = UTF_16BE.decode(&bytes[BOM_UTF16BE.len()..]);
        return (text.into_owned(), enc("utf16be", true));
    }

    if let Ok(text) = std::str::from_utf8(bytes) {
        return (text.to_owned(), enc("utf8", false));
    }

    // Not UTF-8. Ask the detector Firefox uses; it never answers "unknown", so
    // there is always something to decode with, and a wrong answer produces
    // mojibake rather than a file that cannot be opened.
    let mut detector = chardetng::EncodingDetector::new();
    detector.feed(bytes, true);
    let guessed = detector.guess(tld, true);
    let (text, _, _) = guessed.decode(bytes);
    (text.into_owned(), enc(&iconv_name(guessed), false))
}

/// The OS language as a country code the detector understands, or `None` when
/// it is one whose legacy encoding is unambiguous anyway (most of Europe) or
/// one we have no mapping for. Only the ambiguous CJK cases are worth naming:
/// those are the ones where two encodings fit the same bytes.
fn region_hint() -> Option<&'static [u8]> {
    let locale = sys_locale::get_locale()?.to_ascii_lowercase().replace('_', "-");
    let mut parts = locale.split('-');
    let language = parts.next()?;
    let region = parts.last().unwrap_or("");

    // Sliced rather than left as `&[u8; 2]` so every arm has one type.
    Some(match (language, region) {
        ("zh", "tw" | "hk" | "mo") => &b"tw"[..],
        ("zh", _) => &b"cn"[..],
        ("ja", _) => &b"jp"[..],
        ("ko", _) => &b"kr"[..],
        ("ru", _) => &b"ru"[..],
        ("th", _) => &b"th"[..],
        ("tr", _) => &b"tr"[..],
        _ => return None,
    })
}

fn enc(name: &str, is_bom: bool) -> TextEncoding {
    TextEncoding { encoding: name.to_string(), is_bom }
}

/// Translate encoding_rs's WHATWG label into the spelling iconv-lite used, which
/// is what the renderer's encoding menu and save path were written against.
/// Anything without a special case keeps its label lowercased and stripped of
/// separators, which is how the Electron side normalised unknown names too.
fn iconv_name(encoding: &'static Encoding) -> String {
    match encoding.name() {
        "UTF-8" => "utf8".to_string(),
        "GBK" | "gb18030" | "GB18030" => "gbk".to_string(),
        "Big5" => "big5".to_string(),
        "EUC-KR" => "euckr".to_string(),
        "EUC-JP" => "eucjp".to_string(),
        "Shift_JIS" => "shiftjis".to_string(),
        "windows-1252" => "win1252".to_string(),
        other => other.to_ascii_lowercase().replace(['-', '_'], ""),
    }
}

/// How many trailing newlines the file ended with, in the renderer's encoding
/// of that question. 3 means "the file was empty", which is not the same as 0.
fn trailing_newlines(markdown: &str) -> u8 {
    if markdown.is_empty() {
        return 3;
    }
    let bytes = markdown.as_bytes();
    let last = bytes.len() - 1;
    if bytes[last] != b'\n' {
        0
    } else if last >= 1 && bytes[last - 1] == b'\n' {
        2
    } else {
        1
    }
}

/// Load a markdown file, normalising its line endings to LF.
///
/// `preferred_eol` is the user's configured default, used when the file itself
/// does not say — an empty file, or one with a single line.
pub fn load_markdown(
    pathname: &str,
    preferred_eol: &str,
    auto_normalize_line_endings: bool,
) -> Result<MarkdownDocument, String> {
    let bytes = fs::read(pathname).map_err(|e| e.to_string())?;
    // A NUL byte means this is not a text document — a renamed image, a PDF
    // dropped on the window. The detector below never says "I don't know", so
    // without this check binary content decodes to mojibake and opens as a
    // document, where strict UTF-8 used to refuse it outright. Electron drew
    // the line in the same place and for the same reason. It also refuses
    // BOM-less UTF-16, which the detector cannot recognise either; failing
    // plainly beats opening a screenful of CJK noise.
    if bytes.contains(&0) {
        return Err("not a text document".to_string());
    }
    let (raw, encoding) = decode_text(&bytes, region_hint());

    let has_crlf = raw.contains("\r\n");
    // A lone LF, i.e. one not preceded by CR. `lines()` would hide the
    // difference, which is the whole question here.
    let has_lf = raw
        .as_bytes()
        .iter()
        .enumerate()
        .any(|(i, &b)| b == b'\n' && (i == 0 || raw.as_bytes()[i - 1] != b'\r'));

    let is_mixed_line_endings = has_lf && has_crlf;
    let line_ending = if has_crlf && !has_lf {
        "crlf"
    } else if has_lf && !has_crlf {
        "lf"
    } else if is_mixed_line_endings {
        // Mixed: keep whatever the user asked for and normalise on save.
        preferred_eol
    } else {
        preferred_eol
    };

    let markdown = raw.replace("\r\n", "\n");
    // The document is LF from here on. If the file was not, saving has to put
    // it back — unless the user asked for every file to be normalised.
    let adjust_line_ending_on_save =
        !auto_normalize_line_endings && line_ending != "lf";

    Ok(MarkdownDocument {
        trim_trailing_newline: trailing_newlines(&markdown),
        markdown,
        filename: Path::new(pathname)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        pathname: pathname.to_string(),
        encoding,
        line_ending: line_ending.to_string(),
        adjust_line_ending_on_save,
        is_mixed_line_endings,
    })
}

#[tauri::command]
pub fn read_markdown_file(
    path: String,
    preferred_eol: Option<String>,
    auto_normalize_line_endings: Option<bool>,
) -> Result<MarkdownDocument, String> {
    load_markdown(
        &path,
        preferred_eol.as_deref().unwrap_or("lf"),
        auto_normalize_line_endings.unwrap_or(false),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_temp(name: &str, bytes: &[u8]) -> String {
        let path = std::env::temp_dir().join(name);
        let mut f = fs::File::create(&path).unwrap();
        f.write_all(bytes).unwrap();
        path.to_string_lossy().into_owned()
    }

    #[test]
    fn strips_the_utf8_bom() {
        // The bug this module exists for: with the mark left in place the
        // engine lexes `\u{feff}# Title` as a paragraph, so the document loses
        // its heading and keeps losing it on every reopen.
        let mut bytes = BOM_UTF8.to_vec();
        bytes.extend_from_slice(b"# Title\n");
        let (text, encoding) = decode_text(&bytes, None);

        assert_eq!(text, "# Title\n");
        assert_eq!(encoding, enc("utf8", true));
    }

    #[test]
    fn remembers_the_bom_so_saving_can_write_it_back() {
        let (_, encoding) = decode_text(b"# Title\n", None);
        assert!(!encoding.is_bom, "a file without a mark must not gain one");
    }

    #[test]
    fn decodes_utf16_in_both_byte_orders() {
        let mut le = BOM_UTF16LE.to_vec();
        le.extend_from_slice(&[0x23, 0x00, 0x20, 0x00, 0x41, 0x00]); // "# A"
        assert_eq!(decode_text(&le, None).0, "# A");

        let mut be = BOM_UTF16BE.to_vec();
        be.extend_from_slice(&[0x00, 0x23, 0x00, 0x20, 0x00, 0x41]);
        assert_eq!(decode_text(&be, None).0, "# A");
    }

    /// "你好，世界。这是一个用 GBK 编码保存的 Markdown 文件，用来确认解码是对的。"
    const GBK_SENTENCE: &[u8] = &[
        0xc4, 0xe3, 0xba, 0xc3, 0xa3, 0xac, 0xca, 0xc0, 0xbd, 0xe7, 0xa1, 0xa3, 0xd5, 0xe2, 0xca,
        0xc7, 0xd2, 0xbb, 0xb8, 0xf6, 0xd3, 0xc3, 0x20, 0x47, 0x42, 0x4b, 0x20, 0xb1, 0xe0, 0xc2,
        0xeb, 0xb1, 0xa3, 0xb4, 0xe6, 0xb5, 0xc4, 0x20, 0x4d, 0x61, 0x72, 0x6b, 0x64, 0x6f, 0x77,
        0x6e, 0x20, 0xce, 0xc4, 0xbc, 0xfe, 0xa3, 0xac, 0xd3, 0xc3, 0xc0, 0xb4, 0xc8, 0xb7, 0xc8,
        0xcf, 0xbd, 0xe2, 0xc2, 0xeb, 0xca, 0xc7, 0xb6, 0xd4, 0xb5, 0xc4, 0xa1, 0xa3,
    ];

    /// "繁體中文以 Big5 儲存的檔案，這一段用來確認偵測結果。"
    const BIG5_SENTENCE: &[u8] = &[
        0xc1, 0x63, 0xc5, 0xe9, 0xa4, 0xa4, 0xa4, 0xe5, 0xa5, 0x48, 0x20, 0x42, 0x69, 0x67, 0x35,
        0x20, 0xc0, 0x78, 0xa6, 0x73, 0xaa, 0xba, 0xc0, 0xc9, 0xae, 0xd7, 0xa1, 0x41, 0xb3, 0x6f,
        0xa4, 0x40, 0xac, 0x71, 0xa5, 0xce, 0xa8, 0xd3, 0xbd, 0x54, 0xbb, 0x7b, 0xb0, 0xbb, 0xb4,
        0xfa, 0xb5, 0xb2, 0xaa, 0x47, 0xa1, 0x43,
    ];

    #[test]
    fn reads_a_gbk_file_that_strict_utf8_would_reject() {
        assert!(
            std::str::from_utf8(GBK_SENTENCE).is_err(),
            "premise: these bytes are not valid UTF-8, which is why the old path refused them"
        );

        let (text, encoding) = decode_text(GBK_SENTENCE, None);
        assert!(text.starts_with("你好，世界。"), "decoded as: {text}");
        assert_eq!(encoding.encoding, "gbk");
        assert!(!encoding.is_bom);
    }

    #[test]
    fn reads_a_big5_file() {
        let (text, _) = decode_text(BIG5_SENTENCE, Some(b"tw"));
        assert!(text.starts_with("繁體中文"), "decoded as: {text}");
    }

    #[test]
    fn the_region_hint_settles_bytes_that_fit_more_than_one_encoding() {
        // The reason `region_hint` exists. These four bytes are 你好 in GBK and
        // 콱봤 in EUC-KR, and nothing in them says which — a one-line file gives
        // a statistical detector nothing to go on, so the reader's own language
        // decides. Without the hint this file opens as mojibake either way; the
        // point is that it opens as the *right* mojibake for the person reading.
        let short = [0xc4u8, 0xe3, 0xba, 0xc3];
        assert_eq!(decode_text(&short, Some(b"cn")).0, "你好");
        assert_eq!(decode_text(&short, Some(b"kr")).0, "콱봤");
    }

    #[test]
    fn valid_utf8_is_never_handed_to_the_detector() {
        // #3151: `ced` read Greek as GBK and turned µκα into 碌魏伪. Valid UTF-8
        // has to win over any statistical guess.
        let (text, encoding) = decode_text("µ κ α".as_bytes(), None);
        assert_eq!(text, "µ κ α");
        assert_eq!(encoding.encoding, "utf8");
    }

    #[test]
    fn detects_crlf_and_normalises_the_document_to_lf() {
        let path = write_temp("mt-crlf.md", b"# A\r\n\r\ntext\r\n");
        let doc = load_markdown(&path, "lf", false).unwrap();

        assert_eq!(doc.line_ending, "crlf");
        assert!(doc.adjust_line_ending_on_save, "a CRLF file must be written back as CRLF");
        assert!(!doc.markdown.contains('\r'), "the document itself is always LF");
        assert!(!doc.is_mixed_line_endings);
    }

    #[test]
    fn normalising_every_file_turns_the_save_adjustment_off() {
        let path = write_temp("mt-crlf-norm.md", b"# A\r\ntext\r\n");
        let doc = load_markdown(&path, "lf", true).unwrap();

        assert_eq!(doc.line_ending, "crlf");
        assert!(!doc.adjust_line_ending_on_save);
    }

    #[test]
    fn flags_mixed_line_endings() {
        let path = write_temp("mt-mixed.md", b"# A\r\ntext\nmore\r\n");
        let doc = load_markdown(&path, "lf", false).unwrap();

        assert!(doc.is_mixed_line_endings);
        assert!(!doc.markdown.contains('\r'));
    }

    #[test]
    fn counts_trailing_newlines_the_way_the_save_path_reads_them() {
        assert_eq!(trailing_newlines(""), 3, "empty is not the same as none");
        assert_eq!(trailing_newlines("a"), 0);
        assert_eq!(trailing_newlines("a\n"), 1);
        assert_eq!(trailing_newlines("a\n\n"), 2);
        assert_eq!(trailing_newlines("a\n\n\n"), 2, "two or more is one bucket");
    }

    #[test]
    fn refuses_binary_content_instead_of_mojibaking_it() {
        // A PNG header. chardetng always returns *some* encoding, so without
        // the NUL check this would open as a document full of noise.
        let path = write_temp(
            "mt-binary.md",
            &[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d],
        );
        let err = load_markdown(&path, "lf", false).unwrap_err();
        assert!(err.contains("not a text"), "unexpected message: {err}");
    }

    #[test]
    fn reports_a_missing_file_rather_than_panicking() {
        let missing = std::env::temp_dir().join("mt-does-not-exist-9d2f.md");
        assert!(load_markdown(&missing.to_string_lossy(), "lf", false).is_err());
    }
}
