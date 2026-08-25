# marktext-light — 对标上游 MarkText 的功能与体验计划

工作跟踪文档。每轮迭代先读本文件，再按「下一步」继续。

## 上下文

- **本项目**：`marktext-light`，Electron 版 MarkText 正在迁移到 **Tauri 2**（分支 `feat/tauri-migration-phase1`）。
  渲染层仍是原来的 Vue 3 + Pinia + muya，Tauri 侧通过 `src/renderer/src/tauri-bridge/` 重建
  Electron preload 的 `window.*` 接口，让渲染层零改动。
- **源项目**：`../marktext`，即**上游 MarkText 原仓库**（同一 monorepo 结构，本项目的 fork 源）。
  因此「实现源项目全部功能」＝**Electron 版有的能力，Tauri 版必须一个不少**，同时兑现轻量／秒启动／低占用／大文件。

## 差距的量化口径

渲染层与主进程之间的一切能力都走 `mt::*` IPC 通道。因此「离上游还差多少」可以直接测：
统计 `src/renderer` 里 `ipcRenderer.{send,sendSync,invoke,on,once}` 用到的通道，
再看 `tauri-bridge/index.ts` 与 `src-tauri/src/**` 是否实现。

**基线 2026-08-25：116 个通道，实现 18 → 当前 31，缺 85。**
（复测命令见本文件末尾）

缺口按功能域分组：

| 优先级 | 功能域 | 代表通道 | 影响 |
|---|---|---|---|
| ~~P0~~ ✅ | 文件保存 | `mt::response-file-save(-as)`、`mt::save-tabs`、`mt::tab-saved`、`mt::set-pathname` | 已接通 |
| ~~P0~~ ✅ | 关闭前保存提示 | `mt::save-and-close-tabs` → `mt::force-close-tabs-by-id` | 已接通 |
| ~~P0~~ ✅ | 偏好持久化 | `mt::ask-for-user-preference`、`mt::set-user-preference`、`mt::user-preference`、`mt::ask-for-user-data`、`mt::set-user-data` | 已接通 |
| **P1** | 窗口与标签生命周期 | `mt::window-initialized`、`mt::close-window`、`mt::app-try-quit`、`mt::ask-for-close`、`mt::switch-tab-by-index`、`mt::tabs-cycle-left/right` | 关窗、切标签快捷键失效 |
| **P1** | 侧栏项目树 | `mt::ask-for-open-project-in-sidebar`、`mt::update-object-tree`、`mt::rename`、`mt::fs-trash-item` | 打开文件夹后无文件树 |
| **P1** | 全文搜索 | `ripgrep.*`（桥内 stub） | 侧栏搜索面板空转 |
| P2 | 导出／打印 | `mt::response-export`、`mt::response-print`、`mt::show-export-dialog`、`mt::export-success` | 无法导出 HTML/PDF |
| P2 | 图片上传与路径 | `mt::ask-for-image-path`、`uploader.*` | 粘贴图片失效 |
| P2 | 拼写检查 | `mt::spellchecker-*` | 硬缺口，Electron 专有 API |
| P2 | 快捷键自定义 | `mt::request-keybindings`、`mt::keybinding-save-user-keybindings` | 用默认键位可用 |
| P3 | 自动更新 | `mt::UPDATE_*`、`mt::check-for-update` | 可最后做 |
| P3 | pandoc 导入、截图、always-on-top | `mt::cmd-import-file`、`mt::make-screenshot`、`mt::window-toggle-always-on-top` | 边缘功能 |

## 环境限制（重要）

- 本机 **没有 `pkg-config` / webkit2gtk-4.1 / javascriptcoregtk-4.1**；`cargo` 存在但
  `cargo check` 跑满 9.5 分钟无任何输出后被超时杀掉（疑似卡在 crates 索引下载）。
  **Rust 侧一律靠 CI 验证**，本地不要再浪费时间尝试。
- 本地可验证闭环：
  - `pnpm run typecheck`
  - `npx eslint <改动文件>`（**不要**跑仓库级 `pnpm run lint`：它会去扫 `out/`、`out-tauri/`
    构建产物，干净树上就有约 138 万条报错，属既有问题）
  - `pnpm -C packages/desktop run tauri:build-renderer`
  - `pnpm -C packages/desktop exec vitest run <spec>`

## 用户明确要求的验收点

| # | 要求 | 状态 |
|---|---|---|
| 1 | 多文件在**同一窗口以标签页**打开 | ✅ 桥内 `mt::open-file` + 单实例插件（Rust 待 CI 验证） |
| 2 | 默认显示左侧抽屉菜单页 | ✅ Tauri 自举 `sideBarVisibility: true` |
| 3 | 打开过的文件在左侧抽屉**持久留存** | ✅ `store/recentFiles.ts` + 侧栏「最近文件」区块 |
| 4 | 标签页**不**持久化 | ✅ Tauri 下无 buffered-state 通道，天然不恢复（待补 E2E） |
| 5 | 记录仅手动删除 | ✅ 单条 hover ✕ + 「清空最近文件」 |
| 6 | 国际化 | ⚠️ 10 语言就位，`load_locale` 已接；新 UI 文案需同步补 |
| 7 | 深色模式／跟随系统 | ⚠️ `tauri-bridge/theme.ts` 已有，需逐屏走查对比度 |
| 8 | 轻量／秒启动／低占用／大文件 | ❌ 未开工 |

## 已完成

- **`994917fa`** 最近文件抽屉：`store/recentFiles.ts`（localStorage，上限 50）+
  `sideBar/treeRecentFile.vue` + `tree.vue` 区块；`mt::open-file` 在桥内落地为「读盘 →
  `mt::open-new-tab`」；新增**桥内本地事件总线** `dispatchLocal`，让桥代主进程合成的事件
  能触发渲染层既有监听器；10 语言补文案。
- **`7119e075`** 保存链路 `tauri-bridge/save.ts`：`mt::response-file-save(-as)`、`mt::save-tabs`，
  写盘后回发 `mt::set-pathname` / `mt::tab-saved` / `mt::tab-save-failure`；行尾转换与 BOM 对齐
  `writeMarkdownFile`；非 UTF-8 编码**明确报错而非静默转码**（完整方案是后续挪到 Rust 用
  `encoding_rs`）。同 commit 注册 `tauri-plugin-single-instance`，二次启动聚焦已有窗口并开成新标签页。
- **`2beec1d7`** 脏标签页关闭：`mt::save-and-close-tabs`。Electron 用原生三按钮框，Tauri dialog 只有两个，
  所以提示改为渲染层组件 `components/unsavedFilesDialog`（bus 事件 `unsaved-files::ask`，
  同时天然本地化＋跟随主题）。只有**真正落盘成功**的文档才进 `mt::force-close-tabs-by-id`，
  写失败或取消的标签页保持打开而不丢改动。
- **`199c0141`** 偏好持久化 `tauri-bridge/preferences.ts`：写 `<userData>/preferences.json`
  与 `dataCenter.json`（只存用户覆盖项，默认值仍由渲染层 store 提供），debounce 300 ms。
  主题有两个写入方（设置窗口与原生 Theme 菜单），统一走 `theme.ts` 的 `rememberThemeChoice`——
  首帧渲染早于文件读取，所以 localStorage 仍作同步快取，否则重启会显示上一个主题。

## 下一步（按优先级）

1. **窗口与标签生命周期**：`mt::window-initialized`、`mt::close-window`、`mt::app-try-quit`、
   `mt::ask-for-close`、`mt::switch-tab-by-index`、`mt::tabs-cycle-left/right`。
   关窗时要先走 `mt::save-and-close-tabs` 那套提示（已就绪）。
2. **侧栏项目树**：`mt::ask-for-open-project-in-sidebar` → 递归 `readdir` → `mt::update-object-tree`。
   打开文件夹后侧栏目前是空的。
3. **启动性能**：`tauri:build-renderer` 主 chunk 3.59 MB（gzip 1.07 MB），另有 mermaid 543 KB、
   cytoscape 443 KB、wardley 612 KB、katex 261 KB。改成动态 import 按需加载，直接决定「秒启动、加载快」。
4. **大文件**：先建基准（5/20/50 MB 文档的打开耗时与内存），再定优化点。
5. **侧栏项目树 + ripgrep 搜索**：`readdir` 已有，缺 `mt::update-object-tree` 的目录扫描与 watcher。
6. **E2E**：补「重启后标签页不恢复、最近文件仍在」的 Playwright 用例，锁住要求 #3/#4。

## 复测差距的命令

```bash
cd packages/desktop && python3 - <<'PY'
import re, os, collections
used = collections.defaultdict(set)
pat = re.compile(r"ipcRenderer\.(send|sendSync|invoke|on|once)\(\s*['\"]([^'\"]+)['\"]")
for dp, _, fns in os.walk('src/renderer'):
    for f in fns:
        if f.endswith(('.ts', '.vue', '.js')):
            for kind, ch in pat.findall(open(os.path.join(dp, f), encoding='utf-8').read()):
                used[ch].add(kind)
bridge = ''.join(open(os.path.join('src/renderer/src/tauri-bridge', f), encoding='utf-8').read()
                 for f in os.listdir('src/renderer/src/tauri-bridge'))
rust = ''.join(open(os.path.join(dp, f), encoding='utf-8').read()
               for dp, _, fns in os.walk('src-tauri/src') for f in fns if f.endswith('.rs'))
miss = [c for c in sorted(used) if f"'{c}'" not in bridge and f'"{c}"' not in rust]
print(f'总数 {len(used)}  已实现 {len(used) - len(miss)}  缺 {len(miss)}')
for c in miss: print(' ', c)
PY
```
