# MarkText：Electron → Tauri 迁移设计与路线图

- 日期：2026-07-09
- 分支：develop
- 目标：把 MarkText 桌面壳从 Electron 迁移到 Tauri，显著减小**安装包体积**、降低**内存/磁盘占用**、缩短**启动时间**；并顺带排查其它可轻量化的地方。

---

## 1. 现状事实（基于代码扫描）

| 项 | 数量 | 说明 |
|---|---|---|
| 主进程代码 | 10,775 行 / 76 文件 | `packages/desktop/src/main` |
| `BrowserWindow` 引用点 | 233 | |
| `ipcMain` handler | 183 | |
| IPC 契约通道总数 | ~183（invoke/send/sync/event） | `src/shared/types/ipc.ts` |
| 强 Electron 依赖 | electron-store / electron-updater / electron-log / electron-window-state / native-keymap / chokidar / 内置拼写检查 | |

主进程各子系统体量（行）：

```
menu            3642   ← 最大，应用菜单 + 快捷键 + 上下文菜单
app             1588   应用生命周期 / 窗口管理器
ipc             1087   IPC 注册与分发
windows         1017   窗口创建（editor / setting）
keyboard         759   native-keymap 键位映射
filesystem       750   文件 IO + chokidar 监听
contextMenu      291
utils            266
preferences      232   electron-store
editorBufferStore 221
dataCenter       216
commands         128
cli               97
spellchecker      91   Chromium 内置拼写
```

**关键结论（决定可行性）**：渲染层几乎不直接访问 Node（`grep` 无命中），所有 Node/系统能力都走一层定义清晰的桥接面 `window.electron.*` / `window.fileUtils.*` / `window.path` 等（见 `src/preload/index.ts`，299 行）。这是迁移的"干净接缝"——**Vue 渲染层 + muya 引擎基本原样保留，只需在 Tauri 之上重建这层桥接**。

---

## 2. 目标架构

```
                     现在 (Electron)                    迁移后 (Tauri)
  ┌─────────────────────────────────┐      ┌─────────────────────────────────┐
  │ 渲染层 Vue3 + muya + CodeMirror   │  →   │ 渲染层 Vue3 + muya + CodeMirror   │  基本原样保留
  │ (打包的 Chromium)                 │      │ (系统 WebView)                   │  换系统内核 ⚠风险
  ├─────────────────────────────────┤      ├─────────────────────────────────┤
  │ preload 桥接 (window.electron.*) │  →   │ 桥接 shim (invoke 封装, 同名 API) │  重写，签名不变
  ├─────────────────────────────────┤      ├─────────────────────────────────┤
  │ 主进程 Node/TS 10775 行 / 76 文件 │  →   │ Rust 后端 (commands + 插件)       │  从头重写
  └─────────────────────────────────┘      └─────────────────────────────────┘
   electron-builder → *.AppImage             tauri bundler → 更小的 *.AppImage/.deb/.msi
```

**核心策略（strangler / 绞杀者模式）**：
- Electron 版继续保留、可构建，迁移期间不破坏它。
- 新增 `packages/desktop/src-tauri/`（Rust）+ 渲染层桥接 shim，逐阶段把能力从 Node 搬到 Rust。
- 桥接面 `window.electron.*` / `window.fileUtils.*` 的**接口签名完全不变**，底层由"preload 调 Node"换成"invoke 调 Rust command"，渲染层改动量最小。

---

## 3. 两个必须直面的硬缺口

1. **拼写检查**：现用 Chromium 内置拼写（依赖里无 hunspell/nspell，仅 91 行胶水）。Tauri 无内置能力。方案：优先依赖系统 WebView 对 `contenteditable` 的原生拼写；自定义右键建议菜单需重写或降级。
2. **`nodeIntegration: true` 窗口**：editor / preferences 窗口当前直接在渲染进程跑 Node。Tauri 完全无此能力，这两个窗口必须改成走桥接面。

其它需评估但风险可控：
- 系统 WebView 渲染一致性（KaTeX / Mermaid / CodeMirror），尤其 Linux `webkit2gtk`。
- `native-keymap` → Tauri 无等价物，键位映射需用 Rust 侧方案或前端 `KeyboardEvent.code` 重构。
- ripgrep 搜索：现走打包的 rg 二进制；Tauri 可用 sidecar 或 Rust `grep` crate。

---

## 4. IPC 契约 → Rust command 映射（核心分组）

| 前端桥接 API | 现 IPC 通道 | Tauri 侧 |
|---|---|---|
| `fileUtils.*` | `mt::fs::*`（is-file/is-directory/copy/ensure-dir/output-file/move/stat/write-file/read-file/path-exists/unlink/readdir/is-executable/empty-dir） | Rust `commands/fs.rs`，多数可用 `std::fs` |
| `fileUtils.isImageFile` | `mt::paths::is-image` | `commands/paths.rs` |
| `isSamePathSync` | `mt::paths::is-same-sync`（sync） | 前端纯字符串处理 + `commands/paths.rs` 兜底 |
| `electron.shell.*` | `mt::shell::open-external/open-path/show-item` | `tauri-plugin-opener` / `tauri-plugin-shell` |
| `electron.clipboard.*` | `mt::clipboard::*` | `tauri-plugin-clipboard-manager` |
| `electron.windowControl.*` | `mt::win::*` | Tauri `WebviewWindow` API（前端直接调，无需 command） |
| `electron.webFrame.setZoom*` | — | Tauri `setZoom` / CSS zoom |
| `electron.process` / `paths` / `boot-info` | `mt::boot-info`（sync） | `commands/boot.rs` 启动时一次性返回 |
| `commandExists` | `mt::cmd::exists` | `commands/cmd.rs`（`which`） |
| `i18nUtils.loadTranslations` | `mt::i18n::*` | 前端直接读打包 locale，或 `commands/i18n.rs` |
| `ripgrep.*` | `mt::rg::*` | 阶段 6：sidecar 或 Rust grep |
| `uploader.uploadImage` | `mt::uploader::upload` | 阶段 6 |
| `fonts.list` | `mt::fonts::list` | `commands/fonts.rs`（`font-kit`） |
| 菜单 popup / 应用菜单 | `mt::menu::*` | 阶段 4：Tauri menu API |
| 窗口生命周期 / editor bootstrap | `app-*` / `window-*` / `mt::bootstrap-editor` 等 | 阶段 3：窗口管理器重写 |
| 拼写 | `mt::spellchecker-*` | 阶段 5：硬缺口 |
| 自动更新 | `mt::UPDATE_*` / `mt::check-for-update` | 阶段 7：`tauri-plugin-updater` |

---

## 5. 分阶段路线图

每个阶段是一个独立的 spec → plan → 实现 循环。

- **阶段 0（前置）**：安装 Rust 工具链（用户空间）+ 系统 WebView 开发库（Linux 需 `sudo` 装 `webkit2gtk-4.1-dev`、`libgtk-3-dev`、`libayatana-appindicator3-dev`、`librsvg2-dev`）。
- **阶段 1（本次会话地基）**：Tauri 骨架 + 核心 command 垂直切片（fs/shell/clipboard/paths/boot/window）+ 桥接 shim + renderer 独立构建。目标：现有编辑器能在系统 WebView 里加载、打开/保存文件、正常渲染。**验证最大风险 + 拿到真实体积/启动数据。**
- **阶段 2**：文件系统与监听。`chokidar` → Rust `notify` crate；目录树、trash、watcher 事件推送。
- **阶段 3**：窗口管理器与生命周期。多窗口、状态恢复（`electron-window-state` → Rust）、editor bootstrap、CLI 入口、文件关联/deep-link。
- **阶段 4**：菜单与快捷键（最大块，3642 行）。Tauri menu API 重建应用菜单 + 上下文菜单；`native-keymap` 替代方案。
- **阶段 5**：偏好设置与拼写检查。`electron-store` → `tauri-plugin-store`；拼写走 WebView 原生 + 降级。
- **阶段 6**：搜索/上传。ripgrep sidecar 或 Rust grep；图片上传。
- **阶段 7**：自动更新。`tauri-plugin-updater`（需签名与更新源配置）。
- **阶段 8**：平台打包、体积/启动基准测量、CI 接入、逐步下线 Electron。

---

## 6. 顺带的轻量化机会（非 Tauri 相关）

- **Element Plus**：较重的 UI 库；按需引入 / 替换少数组件可减包。
- **legacy `packages/muyajs`**：已在下线中（被 `packages/muya` @muyajs/core 取代）；迁移期彻底移除可减依赖。
- **打包 rg 二进制**：改 sidecar 或 Rust 实现后可去掉。
- 系统 WebView 本身即最大的体积/内存收益来源（不再打包 ~150MB Chromium）。

---

## 7. 验证策略

- 阶段 1 完成后，量化对比：安装包体积、冷启动时间、空载内存 —— Electron 版 vs Tauri 版。
- 渲染一致性：在三平台系统 WebView 逐一验证 KaTeX / Mermaid / CodeMirror / 所见即所得。
- 每阶段保持 Electron 版可构建可回退。

---

## 8. 本次会话交付范围（阶段 1 地基）

- `packages/desktop/src-tauri/`：Cargo.toml、tauri.conf.json、main.rs、capabilities、核心 command 模块（fs/shell/clipboard/paths/boot/cmd）。
- 渲染层桥接 shim：在 `@tauri-apps/api` invoke 之上重建 `window.electron.*` / `window.fileUtils.*` / `window.path` 等，签名与 preload 一致。
- renderer 独立 vite 构建配置 + package.json 脚本。
- 前置依赖说明（Rust + webkit2gtk）。

> ⚠ 受限于当前环境无 Rust 工具链与 webkit2gtk 开发库，本阶段产出为**未编译验证的地基代码**；用户装齐前置依赖后 `pnpm tauri:dev` 方可实际启动。这是数月级工程的第 1 阶段。
