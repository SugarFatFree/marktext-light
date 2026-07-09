# MarkText — Tauri shell (迁移中)

这是 MarkText 从 Electron 迁移到 Tauri 的**阶段 1 地基**。Electron 版仍然可用、可构建；本目录与之并存，逐阶段接管后端能力。完整路线见
`docs/superpowers/specs/2026-07-09-electron-to-tauri-migration-design.md`。

## 已落地（阶段 1）

- Rust 后端骨架：`Cargo.toml` / `tauri.conf.json` / `src/main.rs` / `src/lib.rs`
- 核心 command（`src/commands/`）：`fs::*`、`paths::*`、`cmd::*`、`boot`
- 渲染层桥接 shim：`../src/renderer/src/tauri-bridge/index.ts`
  （在 `invoke` 之上重建 `window.electron.*` / `window.fileUtils.*` / `window.path`，签名与旧 preload 一致）
- 前端独立构建：`../vite.tauri.config.ts`

## 尚未迁移（后续阶段，桥接中以 warn + resolve 优雅降级）

菜单/快捷键、窗口生命周期与多窗口、文件监听（chokidar→notify）、
偏好存储（electron-store→plugin-store）、拼写检查、ripgrep 搜索、
图片上传、自动更新。

## 前置依赖

### 1. Rust 工具链（用户空间，无需 sudo）

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
rustup default stable
```

### 2. 系统 WebView 开发库（**需要 sudo**）

- **Linux (Debian/Ubuntu)**：
  ```bash
  sudo apt update
  sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
      libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev libgtk-3-dev
  ```
- **Windows**：WebView2 Runtime（Win11 自带）+ MSVC Build Tools。
- **macOS**：Xcode Command Line Tools（`xcode-select --install`）。

### 3. JS 依赖

```bash
pnpm install   # 已在 packages/desktop/package.json 声明 @tauri-apps/*
```

## 运行

```bash
# 开发（自动起前端 dev server :5174，再启动 Tauri 窗口）
pnpm -C packages/desktop tauri:dev

# 打包（体积/启动对比用）
pnpm -C packages/desktop tauri:build
```

## 已知限制

- `sendSync` 在 Tauri 下无同步 IPC：`boot-info` 改为启动时一次性 await；
  路径大小写兜底比较退化为前端 JS 比较。
- `webFrame` 缩放、拖拽取文件路径为占位实现，待阶段 3。
- 未编译验证：本机缺 webkit2gtk 开发库，装齐上述系统依赖后方可 `tauri:dev`。
