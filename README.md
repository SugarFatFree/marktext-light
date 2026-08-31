<p align="center"><img src="docs/assets/logo-small.png" alt="marktext-light" width="100" height="100"></p>

<h1 align="center">marktext-light</h1>

<div align="center">
  <strong>:high_brightness: MarkText, rebuilt on Tauri :crescent_moon:</strong><br>
  The same WYSIWYG markdown editor in a shell that ships in megabytes, not hundreds of them.<br>
  <sub>Available for Linux, macOS and Windows.</sub>
</div>

<br>

<div align="center">
  <a href="https://github.com/SugarFatFree/marktext-light/releases/latest">
    <img src="https://img.shields.io/github/v/release/SugarFatFree/marktext-light?label=release&style=for-the-badge" alt="latest release">
  </a>
  <a href="https://github.com/SugarFatFree/marktext-light/releases">
    <img src="https://img.shields.io/github/downloads/SugarFatFree/marktext-light/total.svg?style=for-the-badge" alt="total downloads">
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/github/license/SugarFatFree/marktext-light.svg?style=for-the-badge" alt="LICENSE">
  </a>
</div>

<br>

> **This is a fork.** [MarkText](https://github.com/marktext/marktext) is the original,
> by [Jocs](https://github.com/Jocs) and its contributors, and everything good about
> the editing experience is theirs. marktext-light replaces the Electron shell with
> [Tauri 2](https://tauri.app) and keeps the Vue 3 renderer, so what changes is what
> the app costs to start and to install — not how it edits. Upstream is the place to
> go for the project itself, its docs and its sponsors.

<div align="center">
  <sub>Translations (of the upstream MarkText README):</sub>
  <a href="docs/i18n/README-zh_cn.md#readme">
    <span>:cn:</span>
  </a>
  <a href="docs/i18n/README-zh_tw.md#readme">
    <span>:taiwan:</span>
  </a>
  <a href="docs/i18n/README-jp.md#readme">
    <span>:jp:</span>
  </a>
  <a href="docs/i18n/README-fr.md#readme">
    <span>:fr:</span>
  </a>
  <a href="docs/i18n/README-tr.md#readme">
    <span>:tr:</span>
  </a>
  <a href="docs/i18n/README-es.md#readme">
    <span>:es:</span>
  </a>
  <a href="docs/i18n/README-pt.md#readme">
    <span>:portugal:</span>
  </a>
  <a href="docs/i18n/README-kr.md#readme">
    <span>:kr:</span>
  </a>
  <a href="docs/i18n/README-bn.md#readme">
    <span>:bangladesh:</span>
  </a>
</div>

<div align="center">
  <sub>This Markdown editor that could. Built with ❤︎ by
    <a href="https://github.com/Jocs">Jocs</a> and
    <a href="https://github.com/marktext/marktext/graphs/contributors">
      contributors
    </a>
    .
  </sub>
</div>

<br />

## Screenshot

![](docs/assets/marktext.png?raw=true)

## Features

- Realtime preview (WYSIWYG) and a clean and simple interface to get a distraction-free writing experience.
- Support [CommonMark Spec](https://spec.commonmark.org), [GitHub Flavored Markdown Spec](https://github.github.com/gfm/) and selective support [Pandoc markdown](https://pandoc.org/MANUAL.html#pandocs-markdown).
- Markdown extensions such as math expressions (KaTeX), front matter and emojis.
- Support paragraphs and inline style shortcuts to improve your writing efficiency.
- Output **HTML** and **PDF** files.
- Various [themes](https://marktext.me/docs/themes): **Cadmium Light**, **Material Dark** etc.
- Various editing modes: **Source Code mode**, **Typewriter mode**, **Focus mode**.
- Paste images directly from clipboard.

## What the fork changes

Everything below is measured on this repository's own builds, not estimated.

- **A ~6.7 MB Windows installer**, because a Tauri app links the system WebView
  instead of bundling a browser. Linux, macOS and Windows installers are built by
  CI on every release — see the [releases](https://github.com/SugarFatFree/marktext-light/releases).
- **Something on screen in the document's first frame.** A Tauri window is a WebView
  and nothing else, so there is no native surface to draw a loading screen on while
  the WebView starts. The loading screen is therefore written into the document
  itself — no script, no stylesheet, no image — and paints as early as anything can.
- **Startup you can read.** Every phase from process start to the first document on
  screen is timed and written to `startup.log` in the app's log directory, shell and
  renderer halves in one file. Optimisation work here is held to that trace.
- **Large documents.** Two quadratics in the parser and the event table, plus layout
  thrashing in code-block line numbers, are gone: a 68 KB code-heavy document went
  from 3007 ms to 675 ms to open.
- **One window, many tabs.** Opening a second file — from the CLI, a file association,
  or the dock — focuses the running window and adds a tab instead of starting another
  process.
- **Ten UI languages** (de, en, es, fr, ja, ko, pt, tr, zh-CN, zh-TW), with a test that
  fails the build on an untranslated string or a missing key.
- **Dark mode** follows the OS by default and remembers an explicit choice across
  restarts, including the frame before any stylesheet has loaded.

## Version

| Version | Date | Notes |
|---|---|---|
| [1.0.1](https://github.com/SugarFatFree/marktext-light/releases/tag/v1.0.1) | 2026-09-01 | Documents no longer lose a heading to a byte-order mark, or fail to open because they are GBK. Saves are atomic. A preference changed in the settings window reaches the editor. The window remembers where it was. |
| [1.0.0](https://github.com/SugarFatFree/marktext-light/releases/tag/v1.0.0) | 2026-08-31 | First tagged release of the Tauri shell. Loading screen on first paint; startup, large-document and memory work from the migration. |

## Download and Installation

![platform](https://img.shields.io/static/v1.svg?label=Platform&message=Linux%20x64%20|%20macOS%20x64%2Farm64%20|%20Windows%20x64&style=for-the-badge)

Grab an installer from the [latest release](https://github.com/SugarFatFree/marktext-light/releases/latest).
Release assets are the bare installer files — GitHub does not wrap them in a zip the
way it does workflow artifacts.

Each platform links the system WebView rather than bundling one, which is where
most of the size saving comes from — and it is also the one thing to have on the
machine before installing.

#### Windows

An NSIS installer (`.exe`) for x64. It needs the Microsoft Edge **WebView2** runtime,
which ships with Windows 11 and is installed by the setup wizard on Windows 10 if it
is missing. No arm64 build is published yet.

#### macOS

A `.dmg` each for **arm64** and **x64** — no universal build, so pick the one matching
your machine. The WebView (WKWebView) is part of the OS; nothing else to install.

The app is **not code-signed or notarised**, so Gatekeeper will refuse it on first
open: right-click the app and choose *Open*, or clear the quarantine attribute with
`xattr -dr com.apple.quarantine /Applications/marktext-light.app`.

#### Linux

An `.AppImage`, a `.deb` and an `.rpm` for x64. All three need **webkit2gtk 4.1** and
GTK 3 from your distribution — the same stack CI installs to build them:

```bash
# Debian / Ubuntu
sudo apt install libwebkit2gtk-4.1-0 libgtk-3-0 libayatana-appindicator3-1
```

#### Other

If a build for your platform is missing or fails to start, please open an
[issue](https://github.com/SugarFatFree/marktext-light/issues) on this repository —
not on upstream MarkText, which does not ship these builds.

## Development

If you wish to build marktext-light yourself, start from [CLAUDE.md](CLAUDE.md) for the repository layout and commands, and the upstream [build instructions](https://marktext.me/docs/dev/build) for the platform prerequisites. Note that release installers are built by CI, not locally.

- [User documentation](https://marktext.me/docs/introduction)
- [Developer documentation](https://marktext.me/docs/dev/overview)

Questions and bugs about **this fork** belong in [its issue tracker](https://github.com/SugarFatFree/marktext-light/issues); questions about the editor itself are better asked [upstream](https://github.com/marktext/marktext/issues). PRs are welcome either way.

## Contribution

Please read the [Contributing Guide](.github/CONTRIBUTING.md) before opening a pull request. Day-to-day work lands on `develop`; `main` carries the released versions and is where tags are cut from.

## Contributors

This fork stands on the work of everyone who has contributed to [MarkText](https://github.com/marktext/marktext/graphs/contributors).

<a href="https://github.com/marktext/marktext/graphs/contributors"><img src="https://opencollective.com/marktext/contributors.svg?width=890" /></a>

## License

[**MIT**](LICENSE), the same as upstream MarkText.
