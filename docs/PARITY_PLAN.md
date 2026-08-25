# marktext-light — 对标 marktext-plus 的功能与体验计划

工作跟踪文档。每轮迭代先读本文件，再按「下一步」继续。

## 上下文

- **本项目**：`marktext-light`，Electron 版 MarkText 正在迁移到 **Tauri 2**（分支 `feat/tauri-migration-phase1`）。
  渲染层仍是原来的 Vue 3 + Pinia + muya，Tauri 侧通过 `src/renderer/src/tauri-bridge/` 重建 Electron preload 的 `window.*` 接口。
- **源项目**：`../marktext-plus`，是 **Flutter** 重写的 MarkText（v1.2.3）。它自己的
  `docs/FEATURE_GAP_ANALYSIS.md` 声明相对原版 MarkText 完成度约 40%。
  → 因此「实现源项目全部功能」≈ 保住 MarkText 原有能力 + 补齐 plus 独有的取舍（轻量、秒启动、低占用）。

## 环境限制（重要）

- 本机 **没有 `pkg-config` / webkit2gtk-4.1 / javascriptcoregtk-4.1**，`cargo` 存在但
  `tauri build` / `cargo check` 无法在本地跑通（需要 root 装系统依赖）。
- 因此本地可验证的闭环是：
  - `pnpm run typecheck`
  - `npx eslint <改动文件>`（仓库级 `pnpm run lint` 会去扫 `out/`、`out-tauri/` 等构建产物，
    在干净树上就有约 138 万条报错，属于既有问题，不要当成本次改动引入）
  - `pnpm -C packages/desktop run tauri:build-renderer`
  - `pnpm -C packages/desktop exec vitest run <spec>`
- Rust 侧改动只能靠 CI（`.github/workflows/` 里的 tauri 工作流，手动触发）验证。

## 用户明确要求的验收点

| # | 要求 | 状态 |
|---|---|---|
| 1 | 多文件在**同一窗口以标签页**打开，不新开窗口 | ✅ 已打通（见下） |
| 2 | 默认显示左侧抽屉菜单页 | ✅ Tauri 自举时 `sideBarVisibility: true` |
| 3 | 打开过的文件在左侧抽屉**持久留存**，下次启动仍可见 | ✅ `store/recentFiles.ts` + 侧栏「最近文件」区块 |
| 4 | 标签页**不**持久化 | ✅ Tauri 下无 buffered-state 通道，天然不恢复（需补 E2E 保证） |
| 5 | 记录仅手动删除 | ✅ 单条 hover ✕ + 区块标题「清空最近文件」 |
| 6 | 国际化 | ⚠️ 10 种语言已就位，新增文案已补齐；Tauri 侧 `load_locale` 已接 |
| 7 | 深色模式 / 跟随系统 | ⚠️ 已有 `tauri-bridge/theme.ts`，需逐屏走查对比度 |
| 8 | 轻量 / 秒启动 / 低占用 / 大文件 | ❌ 未开工，见下方「性能」 |

## 已完成（本轮）

- `src/renderer/src/store/recentFiles.ts`：localStorage 持久化的最近文件列表（上限 50，按最近打开排序）。
- `src/renderer/src/components/sideBar/treeRecentFile.vue` + `tree.vue` 的「最近文件」区块：
  点击打开为标签页，hover ✕ 删除单条，标题栏一键清空，折叠状态同样持久化。
- `store/editor.ts` `NEW_TAB_WITH_CONTENT` 里登记最近文件（唯一的开文件入口，复用已开标签页时也刷新时间）。
- `tauri-bridge/index.ts`：
  - 新增**桥内本地事件总线** `dispatchLocal`，让桥自己合成的「主进程行为」能触发既有渲染层监听器；
  - 实现 `mt::open-file` → 读盘 → `mt::open-new-tab`，这是要求 #1 在 Tauri 下真正成立的关键
    （此前该通道只会打印 unhandled 警告，侧栏点文件没反应）。
- 10 个 locale 补 `sideBar.tree.recentFiles / clearRecent / removeFromRecent`。

## 下一步（按优先级）

1. **单实例 + 二次启动送文件**：现在第二次 `marktext-light a.md` 会开新窗口。需要
   `tauri-plugin-single-instance`，把新进程的参数 `emit` 给已有窗口 → `mt::open-new-tab`。（Rust 改动，CI 验证）
2. **性能**：`tauri:build-renderer` 主 chunk 3.59 MB（gzip 1.07 MB）。mermaid / cytoscape / katex / wardley
   应改为动态 import 按需加载，直接决定「秒启动、加载快」。
3. **大文件**：源码模式 CodeMirror 与 muya 在 >5 MB 文档上的表现需要实测基准；
   marktext-plus v1.2.2 修过 "large file freeze"，可参考其做法。
4. **未接通的桥通道**：`ripgrep`（侧栏全文搜索）、`uploader`、`fonts`、watcher、菜单弹出。
   逐个补，缺一个就少一块 plus 已有的功能。
5. **深色模式走查**：新增的「最近文件」区块已复用 `--sideBar*` 变量，其余新 UI 同样要用主题变量。
6. **E2E**：补一条「重启后标签页不恢复、最近文件仍在」的 Playwright 用例，锁住要求 #3/#4。
