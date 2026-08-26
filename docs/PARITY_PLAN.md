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

**基线 2026-08-25：116 个通道，实现 18 → 当前 91，"缺" 25。**
（复测命令见本文件末尾）

**这个 25 不能直接读作"还差 25 个功能"。** 逐条查证后(第 44/53/58/59/63 轮),分三类:

| 类别 | 数量 | 明细 |
|---|---|---|
| **有意不实现 / 不适用** | 4 | `bootstrap-editor`(Tauri 自举)、`load-state`(标签页有意不恢复,已测)、`switch-tab-by-file_path`(应用内无触发方)、`keybinding-save-user-keybindings` + `debug-dump`(前置条件是 Rust 运行时重建加速键) |
| **计数假阳性(功能其实可用)** | 10 | `show-export-dialog`(导出菜单走命令系统)、`cm-copy-as-html` / `cm-copy-as-rich` / `cm-paste-as-plain-text` / `cm-insert-paragraph`(自绘右键菜单派发同名 bus 事件)、`spellchecker-*` × 3 + `spelling-*` × 2(系统/WebView 负责,周边 UI 已隐藏) |
| **真缺口** | 11 | 自动更新 6(需签名密钥 + 更新服务器)、截图 2(Tauri 无对应 API)、`show-notification`(仅 watcher I/O 错误提示)、`window-zoom`(功能可经命令面板到达,缺菜单项)、`spellchecker-get-available-dictionaries`(无词典列表可给) |

**教训**:这个脚本只看"通道名有没有出现在桥或 Rust 里"。
**有意不实现、走别的路径、以及由系统接管的,都会被算成缺口**——
我曾据此三次动手去补其实不存在的缺口(导出菜单、pandoc 导入、窗口置顶)。
**动手前必须先查证那一条到底断没断。**

**计数口径的局限**：脚本只统计 `ipcRenderer.*` 调用点。像 `window.ripgrep.*`、`window.uploader.*`、
`window.fonts.*` 这些独立的 preload 接口面不在其中——所以全文搜索虽已实现，数字上不体现。

缺口按功能域分组：

| 优先级 | 功能域 | 代表通道 | 影响 |
|---|---|---|---|
| ~~P0~~ ✅ | 文件保存 | `mt::response-file-save(-as)`、`mt::save-tabs`、`mt::tab-saved`、`mt::set-pathname` | 已接通 |
| ~~P0~~ ✅ | 关闭前保存提示 | `mt::save-and-close-tabs` → `mt::force-close-tabs-by-id` | 已接通 |
| ~~P0~~ ✅ | 偏好持久化 | `mt::ask-for-user-preference`、`mt::set-user-preference`、`mt::user-preference`、`mt::ask-for-user-data`、`mt::set-user-data` | 已接通 |
| ~~P1~~ ✅ | 关窗握手 | `mt::ask-for-close`、`mt::close-window(-confirm)`、`mt::app-try-quit` | 已接通 |
| ~~P1~~ ✅ | 侧栏项目树（首次扫描） | `mt::ask-for-open-project-in-sidebar`、`mt::update-object-tree` | 已接通；**watcher 未接**，树不随磁盘变化更新 |
| ~~P1~~ ✅ | 标签切换快捷键 | `mt::switch-tab-by-index`、`mt::tabs-cycle-left/right` | 已在渲染层识别键位（`mt::switch-tab-by-file_path` 无触发方，暂不需要） |
| ~~P1~~ ✅ | 文件重命名／删除 | `mt::rename`、`mt::fs-trash-item` | 已接通（trash 用 Rust `trash` crate） |
| ~~P1~~ ✅ | 全文搜索 | `ripgrep.*` → Rust `rg_start`/`rg_cancel` | 已接通（不读 .gitignore，见下） |
| ~~P1~~ ✅ | 右键菜单 | `mt::menu::click/closed` + 编辑器右键 | 侧栏／标签栏／编辑器三处均已接通 |
| ~~P1~~ ✅ | 文件 watcher | `mt::update-object-tree`、`mt::update-file` | 项目树与打开中文档都会跟随磁盘变化 |
| ~~P2~~ ✅ | 设置窗口 | `mt::open-setting-window`、语言同步 | 第二个 Tauri 窗口 |
| ~~P2~~ ✅ | 缩放 | `webFrame.setZoomFactor` | 接到 WebView 缩放 |
| ~~P2~~ ✅ | 导出／打印 | `mt::response-export`、`mt::response-print` | HTML 已通；**PDF 降级为系统打印对话框的「另存为 PDF」** |
| ⚠️ P2 | 图片 | `mt::ask-for-image-path` ✅；`uploader.*`（图床上传）仍是 stub | 本地图片可选，上传不可用 |
| ⚠️ P2 | 拼写检查 | `mt::spellchecker-*` | **代码路径已通,红波浪线未经运行时验证**:偏好 → muya `setOptions` → 编辑器 `spellcheck` 属性,WebView 理应用系统词典标注(Electron 版在 macOS 上正是如此)。**本机无 WebView、E2E 跑的是 Electron(其拼写检查另需主进程配字典),所以这是推断不是实测。** 确定缺的是词典列表、应用内切换语言、右键改正 |
| ~~P2~~ ✅ | 快捷键显示 | `mt::request-keybindings` | 命令面板已显示默认键位；**自定义键位未接** |
| P3 | 自动更新 | `mt::UPDATE_*`、`mt::check-for-update` | 可最后做 |
| P3 | pandoc 导入、截图、always-on-top | `mt::cmd-import-file`、`mt::make-screenshot`、`mt::window-toggle-always-on-top` | 边缘功能 |

## 环境限制（重要）

- 本机 **没有 `pkg-config` / webkit2gtk-4.1 / javascriptcoregtk-4.1**；`~/.rustup/toolchains` 是空目录
  （工具链损坏，连 `rustfmt` 都跑不了）。**Rust 侧一律靠 CI 验证**，本地不要再浪费时间尝试。
- **本地无法运行任何 GUI**，三条路都堵死，已逐一验证过，不要再试：
  1. Tauri：缺 webkit2gtk，装它要 sudo（需密码）。
  2. Electron：**没有 gcc/g++/make**，`electron-rebuild` 建不出原生模块（`ced` 等），
     应用在主进程加载阶段就抛错。
  3. 即便前两条解决，也**没有 X server 也没有 Xvfb**（`DISPLAY` 未设置）。
- **但 CI 一直在跑真实运行时验证**，只是之前没去看：`e2e.yml` 每次推 PR 都会用
  Playwright + 真实 Electron 跑 desktop E2E 套件；`test.yml` / `lint.yml` / `muya-*.yml`
  同样自动运行。**推送后应当一并检查这些，而不是只看手动触发的 tauri-build。**
- `website-deploy.yml` 在本 fork 上**必然失败**：缺 `CLOUDFLARE_API_TOKEN` secret。
  与代码无关，PR diff 含 `pnpm-lock.yaml` 才命中它的路径过滤。
- **E2E 会被下一次推送掐掉**：`e2e.yml` 每次推 PR 自动触发、约需 13 分钟，且同样是
  `cancel-in-progress`。以每 10 分钟一次的节奏推送时，**它永远跑不完**——本会话曾连续 6 次被取消，
  唯一跑完的那次是失败的，而那个失败是编辑器窗口永久空白的真回归。
  **改动渲染层后要留出一轮不推送的时间让它跑完。**
- **触发 CI 前先确认没有正在跑的 run**：`tauri-build.yml` 配了
  `concurrency: cancel-in-progress: true`，再次 `gh workflow run` 会**直接取消上一次**，
  于是那次的验证信号就没了。等它结束再触发下一次。
- **`gh` 命令行已不在本机**（`find /` 全盘搜不到），但 `~/.config/gh/hosts.yml` 里的 token 还在。
  查 CI 状态改用 API，token 不要回显：

  ```bash
  TOKEN=$(grep -A5 'github.com' ~/.config/gh/hosts.yml | grep oauth_token | head -1 | sed 's/.*oauth_token: *//')
  curl -s -H "Authorization: token $TOKEN" \
    "https://api.github.com/repos/SugarFatFree/marktext-light/actions/runs?branch=feat/tauri-migration-phase1&per_page=8"
  # 失败日志：.../actions/runs/<run_id>/jobs 取 job id，再 .../actions/jobs/<job_id>/logs
  ```
- **改了 `src-tauri/**` 必须手动触发 `tauri-build.yml`,否则没有任何流水线会编译它。**
  它只在 `workflow_dispatch` 或推到 `develop` 时跑（见该文件顶部注释：4 平台 Rust 构建太贵，
  每次 PR 同步都跑会和另外约 12 个 workflow 抢 runner）。**本分支上 PR Build 建的是 Electron，
  不碰 Rust**——第 45 轮改完菜单差点就这么推走了。触发方式：

  ```bash
  curl -s -X POST -H "Authorization: token $TOKEN" \
    "https://api.github.com/repos/SugarFatFree/marktext-light/actions/workflows/tauri-build.yml/dispatches" \
    -d '{"ref":"feat/tauri-migration-phase1"}'   # 204 = 已触发
  ```
- **Rust 侧现在有测试了**：`packages/desktop/src-tauri` 的 `#[cfg(test)]` 单测在 CI 的 Linux 作业里
  以 `cargo test --release` 运行（只跑一个平台：纯逻辑，四平台是同一个答案；`--release` 复用
  构建产物，默认的 dev profile 会把所有依赖重编一遍）。本机仍跑不了——工具链损坏。
- 本地可验证闭环：
  - `pnpm run typecheck`
  - `npx eslint <改动文件>`（**不要**跑仓库级 `pnpm run lint`：它会去扫 `out/`、`out-tauri/`
    构建产物，干净树上就有约 138 万条报错，属既有问题）
  - `pnpm -C packages/desktop run tauri:build-renderer`
  - `pnpm -C packages/desktop exec vitest run <spec>`
- `test/unit/specs/watcher-await-write-finish.spec.ts` 在本机**必然失败**：它要加载 Electron 二进制，
  而本机网络装不上（`Electron failed to install correctly`）。属环境问题，不是回归。

## 用户明确要求的验收点

| # | 要求 | 状态 |
|---|---|---|
| 1 | 多文件在**同一窗口以标签页**打开 | ✅ 桥内 `mt::open-file` + 单实例插件;**已在真实运行的应用里验证**(`tabs-not-windows.spec.ts`,E2E `22d77ecc`):开三个文档 → 三个标签、`app.windows()` 始终为 1;同路径再开只置为活动、不新增 |
| 2 | 默认显示左侧抽屉菜单页 | ✅ Tauri 自举 `sideBarVisibility: true`(在 `store/editor.ts` 的 `isTauri()` 分支,不在桥里);`sidebar-open-by-default.spec.ts` 钉住链条两端 —— **布局 store 自身默认是 `false`**,不写就是收起的 |
| 3 | 打开过的文件在左侧抽屉**持久留存** | ✅ `store/recentFiles.ts` + 侧栏「最近文件」区块；**已在真实运行的编辑器里验证**（E2E `28231b26`） |
| 4 | 标签页**不**持久化 | ✅ 桥把 `update-buffer-state` 放进 `IGNORED_INVOKES`（有意为之，非巧合）；`no-tab-restore.spec.ts` 双向锁住。**E2E 验不了**——Electron 版本本来就会恢复 |
| 5 | 记录仅手动删除 | ✅ 单条 hover ✕ + 「清空最近文件」；**已在真实运行的编辑器里验证**（E2E `28231b26`） |
| 6 | 国际化 | ✅ 10 语言键集完全一致，`locale-parity.spec.ts` 锁死 |
| 7 | 深色模式／跟随系统 | ⚠️ **真实窗口量测已通过**（E2E `d2f42abb`，223 用例全绿）：界面确实变暗，且无不透明文字低于 3:1。前两次失败都查证为测量方法问题。**证明的是「读得出来」，不是「好看」**；目视验收仍缺 |
| 8 | 轻量／秒启动／低占用／大文件 | ⚠️ 启动首屏 −78%；解析已线性。**但约 850 KB 的文档会让渲染层饱和 >105 秒**（第 48 轮 CI 实测），打开大文档的二次方**已修复**(引用定义改为按文档版本收集):渲染 13.9 s → 约 3 s;打字 172 → **约 45 ms/击键**。首次实测:渲染层 **1.0–1.2 s** 可用、JS 堆空白 **11 MB** / 139 KB 文档 **+4.3 MB**。**口径见下,不等于整进程或 Tauri 实测**,未完成 |

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
- **`15607c41`** 关窗握手 `tauri-bridge/window.ts`：用 Tauri 的 `onCloseRequested` 复刻
  Electron「主进程否决关闭 → 先问渲染层」的流程。**与上游的一处有意分歧**：保存失败或用户取消
  保存对话框时保持窗口打开；上游会照关不误，等于丢掉用户刚选择要保留的改动。
- **`3c657770`** 侧栏项目树：新增 Rust 命令 `scan_project`（一次调用走完目录，而不是
  `readdir` + 每项一次 `stat`），桥内 `project.ts` 把结果重放成 watcher 同款的
  `addDir`/`add` 事件。**只回元数据**——上游 watcher 会把每个 md 文件内容预读进事件、
  而 `treeCtrl.addFile` 转手就丢掉，省掉这次读盘正是大目录打开快的关键。

### 启动性能（要求 #8 的前半）

- **`518c42c8`** 首屏 eager chunk **3512 KB → 760 KB**。两处元凶：
  `app.use(ElementPlus)` 把全部约 80 个组件钉进入口 chunk（本项目只用 25 个，改为逐个注册，
  cascader/carousel/transfer/calendar/upload/timeline 等不再打包）；路由静态 import 了
  编辑器与设置两棵页面树，改为 `() => import()`，一个窗口只会去其中一棵。
  注意：**往模板里加新的 `<el-…>` 标签时，必须同步加进 `main.ts` 的注册清单**。
- **`844bbd49`** 源码模式（CodeMirror）改 `defineAsyncComponent`：编辑器 chunk 649 → 381 KB，
  剩下 267 KB 只有真正切到源码模式的会话才取。
- **`8f772a6d`** 主题按需加载：32 个主题 CSS + 31 个 prism CSS 原本是 63 个 `?inline` 静态导入
  （约 260 KB 字符串常量）挤在首屏 chunk 里，只为显示其中一个。改用 `import.meta.glob` 后，
  它们共用的那个 chunk 从 231 KB 降到 11 KB。33 分支的 switch 塌缩成文件名查表——配对本来就是
  机械的（主题 x 配 prism x，只有 `material-dark` 一个例外）。
  代价：应用主题变成异步，body/CodeMirror 的 class 先同步设好、CSS 到了再写入（含竞态保护）。

实测体积（`packages/desktop/out-tauri/renderer/assets/`）：

| 阶段 | 编辑器首屏静态闭包 |
|---|---|
| 优化前 | 3512 KB |
| Element Plus 按需 + 设置页懒加载 | ~2700 KB |
| CodeMirror + 主题按需 | **2494 KB** |

**一处曾经的误读**：中途把编辑器页也改成异步路由，让"入口 chunk"降到 787 KB，看起来很漂亮——
但编辑器窗口本来就要把那 2498 KB 全部加载，异步只是把同样的字节拆散，**没有让它少读一个字节**。
更糟的是它打破了 Electron 的启动握手（见下），所以已改回同步。**该看的数字是首屏闭包，不是入口 chunk。**

已确认**不在**首屏闭包内（muya 自己按需取）：katex、mermaid、cytoscape、wardley、embed。
剩下 2469 KB 的构成：muya 引擎 1284 KB + 入口 762 KB（Vue + 25 个 Element Plus 组件 + pinia +
router + vue-i18n + en 语言包）+ 编辑器页 381 KB。
语言包本来就是按需的：只有 en 静态打包，其余走 Rust 的 `load_locale`。

### 国际化与深色模式（要求 #6 / #7）

- **`cf0254f5`** —— 脚本化审查后发现两类真问题：
  - **8 种语言各缺 2 个键**（`menu.theme.followSystem` / `light`，Tauri 主题菜单新增时只补了
    en 与 zh-CN）。缺键在渲染层和 Rust 原生菜单里都会静默回退到英文，所以表现为
    「一个已翻译的菜单里混着两条英文」而无人报错。已补齐，并加
    `test/unit/specs/locale-parity.spec.ts` 断言**每种语言的键集与英文完全相等**
    （多出的键同样失败：要么是永远读不到的拼写错误，要么是英文删了这边没删）。
  - **两处 frameless 标题栏把窗口控制图标写死 `#000000`**
    （`components/titleBar` 与 `prefComponents/common/titlebar`）。标题栏背景跟随主题、图标不跟，
    深色主题下就是近黑底上的黑图标。改成 `fill: currentColor` + 主题色，与 Tauri 菜单栏的
    窗口控制按钮做法一致。关闭按钮保留白图标——它 hover 时是饱和红，两种主题下都成立。
- 已核对：新增组件用到的 `--sideBarColor` / `--sideBarItemHoverBgColor` / `--highlightThemeColor` /
  `--editorColor50` 在 32 个主题或基础样式里均有定义。
- 扫描发现的其余 159 处硬编码色多为合理：主题预览色板（100 处）、Windows 关闭按钮红、
  `var(--x, fallback)` 的兜底值。
- **仍缺**：真实窗口里的目视验收（本地无 WebView）。

### 标签与文件操作

- **`19b6b0a3`** 重命名与删除：`mt::rename` 在桥内改名并回发 `mt::set-pathname` 让标签页跟上，
  保留「目标已存在 → 替换／取消」两按钮提示（默认取消，替换是破坏性的那个）。
  `mt::fs-trash-item` 用 Rust `trash` crate 进回收站，对齐 Electron 的 `shell.trashItem` 而非直接删除。
  侧栏自身的重命名本来就能用——它走 `fileUtils.move` 而不是 IPC。
- **`a5e1c7db`** 标签快捷键：Ctrl+Tab、Ctrl+PageUp/PageDown、Ctrl+1…0 原本是主进程加速器。
  Tauri 对「非菜单项的加速器」没有对应机制，与其往原生菜单塞十几个隐藏项，不如在渲染层识键、
  派发到渲染层本来就监听的通道。键位对齐 `src/main/keyboard/keybindings*.ts`（含 macOS 用 Cmd 管
  PageUp/Down、Ctrl 管循环）。`test/unit/specs/tab-shortcuts.spec.ts` 锁死映射，
  特别是 **Ctrl+0 是第十个标签**、**Ctrl+Alt+数字 要留给标题快捷键**。

### 全文搜索

- **`246d8f88`** 侧栏搜索面板此前完全空转：桥里的 `ripgrep` 对象是一组空函数，因为 Tauri
  不带 Electron 版所依赖的 ripgrep 二进制。改为在 Rust 里自己走目录 + 匹配
  （`src-tauri/src/commands/search.rs`），沿用同一套 `mt::rg::*` 事件与 `searchId` 信封，
  所以 `ripgrepSearcher.ts` 及其调用方一行未改。两种模式都覆盖：侧栏要的匹配行、快速打开要的路径列表。
- **与真 ripgrep 的两处差距**（写在模块头注释里，不假装没有）：
  - **不读 `.gitignore`**。固定跳过 `node_modules`、`.git` 与点开头条目（除非勾选包含隐藏文件）。
  - **排除模式只支持 `*`、`**`、`?`**，不是完整 glob 语法。
- 匹配位置按**字符**计数而非字节——渲染层要拿它去 JS 字符串里定位高亮。

### 桥接面的其余补齐（第 13–14 轮）

- **`755e4c4e`** 导出与打印。HTML 完整实现；**PDF 是有意降级**：上游用 Electron `webContents.printToPDF`
  抓页面，Tauri 无对应 API，改走 WebView 自带打印对话框的「另存为 PDF」。此时渲染层已换上打印布局
  DOM（正是 printToPDF 当年抓的那份），文档内容一致，但目标路径由系统对话框决定、不回传，
  所以 **PDF 没有成功通知**。打印布局的拆除放在 `finally`，否则取消打印会把编辑器卡在打印视图。
- **`3c299faa`** 五个文件/窗口对话框：移动文件、图片选择、图片目录、默认打开目录、窗口置顶。
  两个目录选择器写完偏好还要回推 `mt::user-preference`——偏好 store 只通过那个通道感知变化。
  踩坑：从 `common/filesystem/paths` 引 `IMAGE_EXTENSIONS` 会**直接构建失败**（该模块 import 了 Node 的 `fs`），
  改为内联，与桥内已有的 `MARKDOWN_EXTENSIONS` 同理。
- **`ef33f3aa`** 命令面板的文件命令。**「新建窗口」映射为新建标签页**——本项目按要求是单窗口多标签，
  再开窗口会与单实例处理器冲突。（若希望改为从面板移除该命令，需另行决定。）
- **`6941968f`** 窗口状态与拖放：自定义标题栏此前永远不知道窗口被最大化；拖 markdown 到窗口现在能打开成标签页
  （WebView 的 DOM drop 事件不带路径，改用窗口自身的 drag-drop 事件）。
- **`3fd14f57`** 显式吞掉「本就不该有去处」的通道。`mt::editor-selection-changed` **每次光标移动都会触发**，
  此前落到未处理分支、每次打一条 `console.warn`——在大文档上是真实开销。
  `update-buffer-state` 同样吞掉，但理由不同：**丢弃它正是「标签页不持久化」的实现机制**。
  同时补 `test/unit/specs/recent-files.spec.ts` 覆盖要求 #3/#5。

### 大文件（要求 #8 的后半）

**`c866a62b`** —— 建基准时直接撞出两类真问题：

1. **1 MB 文档根本打不开**：`lexBlock` 与 `markdownToState` 都用
   `push(...tokens)` / `unshift(...tokens)` 展开 token 列表，实参个数超引擎上限 →
   `RangeError: Maximum call stack size exceeded`。改为不展开地逐个追加。
2. **解析是二次的**（0.25 MB 0.6 s，2 MB **101 s**）。两处元凶都是「每个 token 重新分配一次数组」：
   - marked 自己的 `walkTokens` 每访问一个节点就 `values = values.concat(callback(...))`。
     muya 根本不读这个累积数组，改为自己线性遍历（768 KB 文档的 `lexBlock`：9.7 s → 0.46 s）。
   - `markdownToState` 把数组当队列用，`shift()` 消费、`unshift()` 展开容器，两者在大数组上都是 O(n)。
     改为反向持有 token，两者都变成 `push`/`pop`。

实测（同一台机器）：

| 文档大小 | 修复前 | 修复后 |
|---|---|---|
| 0.25 MB | 610 ms | 90 ms |
| 1 MB | 24.7 s | 0.85 s |
| 2 MB | **101.5 s** | **3.0 s** |
| 8 MB | 直接崩溃 | 43.4 s |

**第三处热点**（`f79f503e`）：marked 会对**每个块边界**用整段剩余源码调用扩展的 `start()`，
而 `blockKatex.start` 是 `src.indexOf('\n$')`——文档里没有 `$` 就每次扫到底，又是二次。
按「文档能否匹配该规则」决定是否注册：两条规则都需要 `$`；块级规则匹配的是 `$$\n…\n$$`，
凡它能匹配的文本必然含 `\n$`。

| 4 MB 文档 | 修复前 | 修复后 |
|---|---|---|
| 无公式 | 11.2 s | **0.55 s** |
| 含行内公式 | 23.6 s | **0.83 s** |
| 结尾一个 `$` | 11.4 s | **0.52 s** |

**解析耗时对文档大小已回到线性。**门控写错会静默丢公式而不是报错，所以
`mathRuleGating.spec.ts` 把推理钉死，并用变异测试验证过：强制关掉任一条规则，对应用例都会失败。

回归防护：`packages/muya/src/state/__tests__/largeDocumentParse.spec.ts`（只断言 2 MB 能解析成功——
崩溃是硬性通过/失败；耗时不做断言，阈值紧到能抓回归就会在负载高的 CI 上误报）。
改动已由 muya 自己的 1443 个单测 + 1347 个 CommonMark/GFM 一致性用例验证。

复测：`pnpm -C packages/desktop run tauri:build-renderer && pnpm run bundle-size`
（脚本 `scripts/bundle-size.ts` 算的是**静态闭包**，不是最大 chunk——动态 import 后面的东西
不该计入首屏）。

### 桥接面收尾（第 15–24 轮）

- **`f9442c7d`** 命令面板显示快捷键。三张键位表从 `src/main/keyboard/` 移到
  `src/common/keybindings/`（纯数据、零 import、原本只有一个引用方），两个进程都能用。
  **只有默认键位**：用户自定义的键位存在 Electron `Keybindings` 类管理的文件里，尚未读写。
- **`196c0c48`** 打开中的文档被外部修改时会察觉：Rust 只报「某路径变了」，文档在桥里组装
  （桥打开文件时本来就在做这件事，在 Rust 里再实现一遍编码/行尾探测等于养两份会漂移的实现）。
  必须读取内容而非只报告变化——渲染层要拿新内容比对，相同则静默跳过，这样自身的保存不会打扰用户。
- **`9fbc3192`** 自绘菜单栏（Windows/Linux 实际看到的那个）加勾选态。状态**每次渲染时从 store 读**，
  而不是同步进菜单——原生菜单自持 checked 标志正是它会漂移的原因。
- **`adb610d5` / `f46161c6`** 右键菜单。Tauri 不提供「在坐标弹出原生菜单并回报选中项」，所以画在页面里。
  编辑器那套在上游完全由主进程的 `webContents` 钩子构建，这里改为从 DOM 选区组装、直接派发到
  `mt::cm-*` 监听器所喂的 bus 事件。**粘贴不能用 `execCommand`**（WebView 必然拒绝），改为
  经桥读剪贴板 + 合成 `paste` 事件走 muya 自己的处理器；Ctrl+V 不走这条路、不受影响。
- **`4b0517cc`** 图片路径补全。匹配走 `fuzzaldrin`（渲染层已在用，排序与上游一致）；
  一次 Rust 调用拿到带类型的目录条目；**不做缓存**——上游的缓存挡的是本不存在的开销，
  而缓存过期正是刚加进去的图片显示不出来的原因。
- **`d1b87e97`** 修掉一个静默失效：View 菜单的「目录」派发 `mt::toggle-view-layout-entry('toc')`，
  而 `TOGGLE_LAYOUT_ENTRY` 只认 `showSideBar`/`showTabBar`，其余一声不吭地丢掉。
  侧栏面板是**选择**而非切换，应走 `mt::set-view-layout`。顺带补回上游有而本项目丢失的
  「重新加载图片」「命令面板」「行尾 LF/CRLF」四项。

### 用 CI 的 E2E 做真运行时验证（第 41 轮）

- **`bb5497eb`** 切进源码模式会吞掉最后一次击键。引擎把编辑批进 operation cache、下一帧才 apply；
  源码模式的初值取自 store 上一次收到的 markdown（只在 `json-change` 时刷新，即那一帧之后），
  退出时又把自己的内容写回文档——于是那次击键先被漏掉、再被覆盖。`flush()` 本就是为这件事存在的
  （#2938 的标签切换），源码模式这条路径没调用。
  **发现方式**：E2E 在 `b1548c70` 上失败，而那个提交只改了一个单测文件、零行运行时代码——
  所以不是回归，是本就存在的偶发。日志显示输入 `' typed-token'` 读回 `' typed-toke'`，
  轮询 5 秒都补不回来（切换时的快照已定型）。**平时那一帧多半赶在 IPC 往返之前落下，所以只偶发。**
- **`28231b26`** 最近文件抽屉的运行时用例。要求 #3/#5 此前只有 store 层单测，
  没验过抽屉真的渲染出条目、以及删除按钮才是唯一的移除方式。
  **重启后仍在**这一条不放进 E2E：渲染层 `page.reload()` 看不出来——主进程用 `once` 挂
  bootstrap 握手，重载后不再补发，侧栏根本不会渲染。那条留在单测里验存储往返。

### 「读文档前必须 flush」的其余两处（第 42 轮）

顺着源码模式那个 bug 的形状把所有读文档的路径过了一遍。已 flush 的:保存、另存、移动、
重命名、切标签（#2938 / #3803 做过）。**漏掉的两处**,`2ed649bb`:

- **导出 / 打印**:`getMarkdown()` / `getTOC()` 读的是已 apply 的文档,刚敲完字就导出会导出一份缺字的。
- **关闭窗口**（更严重）:`mt::ask-for-close` 先快照各标签、再筛 `!isSaved`,两步读的都是已 apply 的文档。
  **若那次待提交的编辑是该标签唯一的编辑,`isSaved` 仍为 `true`,标签被筛掉,窗口不提示直接关闭。**
  而且帧根本不会派发给被遮挡或隐藏的窗口——从任务栏关窗时正是这个状态,那批操作可以无限期悬着,
  不是"悬一帧"。

`flush-before-reading-document.spec.ts` 锁住各站点「flush 早于 read」的顺序,含已修过的三处。
是**源码级**断言:引擎层保证由 muya 自己的 `flushPendingOps.spec.ts` 覆盖,反复出问题的是读取方忘了调。
已做变异验证(拿掉关闭路径的 flush → 断言退回后面那个 flush,顺序判定正确失败)。

**E2E `28231b26` 通过:221 个用例、217 通过、0 失败**（上一轮 219 个、1 失败）。
新增的抽屉用例在真实编辑器里跑过,要求 #3/#5 首次拿到运行时证据;
`editor-input.spec.ts` 也恢复通过——但它本就是偶发,单次通过不构成证明,信心来自根因已定位。

### 深色模式改用真实窗口量测（第 43 轮）

一直把要求 #7 记作「本地跑不了 GUI，只能静态审查」——**但 E2E 有一个真实 Electron 窗口**。
`dark-theme-contrast.spec.ts` 在那里发 `mt::user-preference {theme:'dark'}`，
等编辑器背景真的变暗（主题 CSS 是按需加载的，晚一两帧才到，所以等重绘而不是等事件），
然后在页面内量四个界面的**文字/背景对比度**（WCAG 相对亮度公式）。

这正好命中深色模式的典型缺陷:为浅色写的颜色被留下,背景变暗、文字跟着暗,元素读不出来。
静态审查能找出硬编码字面量,**但看不出级联最终落在哪一个上**——只有真实窗口能。
门槛先定 3:1（AA 正文是 4.5:1）:够抓「整块没改过样式」,又不会被装饰性灰字误伤。
背景取最近一个**真正上色**的祖先（半透明层跳过而非混合——透过它读到的本来就是后面那层）。

**它证明不了「好看」**,只证明「读得出来」。目视验收仍然缺,仍然需要在有 webkit2gtk 的机器上跑安装包。

### 命令面板的快速打开是死的（第 44 轮）

复测通道后逐个查证「缺失」项,发现 **`mt::open-file-by-window-id` 没有路由**——
命令面板选中文件后发的就是它,而桥对未处理的 send 只打一条 `console.warn`,
**所以选了文件什么都不会发生,而且是静默的**。`5d1e2ee1` 接上,复用已有的 `openFileAsTab`:
`NEW_TAB_WITH_CONTENT` 本来就按路径去重并切到已有标签,行为正好对。

**与上游的一处有意分歧**:上游在这里会看 `openFilesInNewWindow` 偏好、可能开第二个窗口;
这里不看——你的要求是永远开标签页,不开新窗口。

`quick-open-routes.spec.ts` 走**真实路由表**而非源码断言(要防的正是"落到 default 分支"),
mock 掉 8 个 Tauri 模块后跑 `installTauriBridge()`,再发一次 send 看有没有开出标签页。
已做变异验证(去掉 case → 两条用例同时失败)。

**顺带查证出两处记载有误,已改正:**

- **导出菜单不是坏的**。计数把 `mt::show-export-dialog` 算作缺失,但 Tauri 菜单的
  `cmd:file.export-file` 走的是 `mt::execute-command-by-id` → 渲染层命令系统,
  而 `file.export-file` 命令(含 html/pdf 子命令)是注册了的。属计数假阳性。
- **pandoc 导入早就做完了**。`commands::cmd::pandoc_to_markdown` 已在 `lib.rs` 注册,
  桥内 `import.ts` 已接,拖入 .docx 也走这条。文档里"还缺一个 Rust 命令"是过时的。

**教训**:通道计数只是线索,`bootstrap-editor`、`load-state` 这类**有意不实现**的
和走了别的路径的都会被算成缺口。动手前先查证那一条到底断没断。

### 深色模式用例首跑失败——是测试错了,不是应用错了（第 44 轮）

`ea2b5bc4` 上 E2E 报了两条,查证后**两条都是我的测量方法有问题**:

- **`.title-bar` 量到纯白**。它是 `background: transparent` + `position: fixed`,
  我的祖先遍历爬的是 **DOM 祖先**,而它视觉上的背衬是**同级**的 `.title-bar-editor-bg`
  （用 `var(--editorBgColor)`,主题是对的）。→ 脱离文档流的元素不能这样量。
- **`.editor-tabs` 黑字对比度 1.42**。容器自己不设 `color`,继承了默认黑;
  真正的标签文字在 `.tab` 上是 `var(--editorColor50)`。→ 量容器等于量了一个没人看见的颜色。

改法(`6a8a09c3` 之后）:

- **只量真正绘制文字的元素**——直接子节点里有非空文本节点的,遍历 `body *`,不再手写选择器清单。
- **判据换成「不透明」**。主题里的文字色**全部带 alpha**（`--editorColor` 就是
  `rgba(255,255,255,0.7)`,50/30 更淡）,所以**不透明的文字色必然是硬编码残留**——
  这正好就是要抓的缺陷类别,且几乎不会误报。
  **局限也写在用例注释里**:硬编码成 `rgba(0,0,0,0.7)` 就抓不到。
- 背景仍走祖先遍历,但**只用于文字**——文字在正常流里,它的绘制盒就是祖先,这条成立。
- 两项测量合并成**一次 evaluate**,顺带去掉了 `new Function` 那个本地无法证伪的技巧。

**教训**:这类"在真实运行时量"的用例,第一次失败先怀疑测量本身。
两条报错看上去都像真缺陷,查下去都不是。

### 菜单对齐:Windows/Linux 打不开设置（第 45 轮）

通道数只覆盖 IPC,**菜单本身也是"源项目的功能"**,于是拿两边的 i18n 键做了次差集。
**这个指标同样不可尽信**——`PredefinedMenuItem`(剪切/复制/粘贴/退出/最小化/全屏…)
由系统本地化、不走 i18n 键,所以一上来报的 41 个"缺失"里有一大半是假的。逐项核实后:

- **`cmd:file.preferences` 只在 `#[cfg(target_os = "macos")]` 的应用菜单里**。
  非 macOS 没有那个菜单,别处也没有它 → **Windows/Linux 的 Tauri 版,菜单里根本打不开设置**。
  上游 Electron 正是把它放在文件菜单里的。已加到文件菜单(非 mac)与自绘菜单栏。
- **导入没有菜单入口**。`pandoc_to_markdown` + 桥都齐了,但只能靠拖拽触发。已加。
- **段落缺「提升/降低标题级别」**。渲染层 `paragraph.upgrade-heading` /
  `degrade-heading` 命令都在,菜单两边都没有。已加。

**三项都不带加速键**,理由写在代码注释里:加速键字符串解析失败是**运行时**错误,
编译器和 CI 都拦不住,而且**会让整个菜单建不起来**。本机没有 Rust 工具链验不了,
不拿"Linux 上菜单全没了"去换一个快捷键。等能跑起来的人补。

`menu-parity.spec.ts` 守住这个"两个文件描述同一个菜单"的结构:
`src-tauri/src/menu/mod.rs` 建原生菜单,`components/menuBar/structure.ts` 画无边框
Windows/Linux 上顶替它的那条栏——**只改一边就等于一半用户少一个功能,而两个文件连语言都不同**。
用例比对可分发 id 集合、检查 Preferences 的 cfg 位置、并验证所有 labelKey 在 en.json 里有翻译
(键写错只会渲染出原始键,而且只有打开那个平台那个菜单的人看得见)。已做变异验证。

**仍缺的菜单项**(功能多数可经命令面板到达,只是菜单里没有):帮助菜单整个(7 项)、
截图、自动保存开关、最近打开子菜单、窗口缩放/置顶、重载窗口/开发者工具、
macOS 的 showAll / bringAllToFront。

### 深色模式用例第二次失败——还是测量方法（第 45 轮）

`17fa4d0d` 上只报一条:标题栏的字数统计 `span.text-center-vertical`,
不透明 `rgb(179,179,179)` on `rgb(255,255,255)`,2.1:1。

**背景那个白色是我 `surfaceBehind` 的 fallback**——标题栏又是 `transparent` + `fixed`,
祖先链全透明,于是"没找到就当白色"。真实背衬是 `--editorBgColor`(深色主题为 `#282828`),
`#b3b3b3` 配 `#282828` 约 6:1、完全可读。**2.1 是个错数字。**
已改:测不出背衬就**跳过**,并把 `measured` / `skipped` 报出来,外加一条
「measured > 0」的断言——否则哪天全被跳过,这个检查会空绿。

**但顺带发现一个真问题,尚未修**:深色主题下 `--editorColor30` 解析成了**基础样式的
不透明 `#b3b3b3`**(`assets/styles/index.css:27`),而不是 `dark.theme.css` 里的
`rgba(255,255,255,0.3)`。两者都在 `:root`,`--editorBgColor` 又确实生效了(`#282828` 量到了),
所以像是**样式注入顺序**问题:主题是运行时 append 到 head 的 `<style>`,
若某个按需 chunk 的 CSS 后到,基础值就会反超。
**视觉上无害**(甚至比 0.3 alpha 更清楚),但意味着**深色主题的变量覆盖不可靠**,值得单独查。

### 悬案了结 + Rust 改动已编译（第 46 轮）

- **Tauri Build 在本分支四平台全绿**(`d2f42abb`),含 linux / windows-x64——
  第 45 轮的菜单改动确实能编译。**注意 macOS 那个作业证明不了这点**:
  新增的 Preferences 项在 `#[cfg(not(target_os = "macos"))]` 里,macOS 上根本不参与编译。
- **`--editorColor30` 的悬案:断言通过,说明主题变量确实全部生效**
  (`--editorBgColor` = `#282828`,`--editorColor` / `30` / `50` 均为 `rgba(...)`)。
  所以第 45 轮"基础样式反超"的读法**是错的**。
  **但我没有查明那次为何量到不透明的 `#b3b3b3`**——不编故事,如实记下:
  断言已常驻,再出现会直接打印四个变量的实际取值。
  顺带查清一件事:基础样式同时定义 camelCase 与 kebab-case 两套
  (`--editorColor30` / `--editor-color-30`),深色主题里 kebab 那套是**引用** camel 那套的。

### 大文件的渲染侧,第一次被量（第 46 轮）

`large-document-render.spec.ts`:三处二次方修复此前**只在解析层用单测量过**,
而用户等的是「解析 + 建块树 + 渲染」。本机没有 WebView,E2E 是唯一能量的地方。
做法是**先用小文档启动、再把约 850 KB 的文档以新标签页送进去**——否则 Electron 那几秒
启动开销会淹没文档本身的耗时。等的是全部 1200 个小节的标题进入 DOM(而非首屏)。
第二条用例在打开后**再打字**:当年的二次方同样让每次击键变慢,只量渲染会漏掉。
**预算是绊线不是指标**,耗时会打印出来,拿到几轮真实数字后再收紧。

### 帮助菜单补齐（第 47 轮）

上游帮助菜单 8 项,这里只有 2 项。补上 changelog / 关注 / 赞助 / 提问 / 报 bug / 源码 / 许可证 7 项。

**没有用 Rust 开链接**,虽然 `tauri-plugin-opener` 就在依赖里。渲染层已有现成机制——
`docs.markdown-syntax` 走的是 `window.electron.shell.openExternal`,桥里就是 `openUrl`。
做成命令,原生菜单和自绘菜单栏就都能经**它们本来就共用的那条 dispatch** 到达,
而且改动是 TypeScript,本地就能验;Rust 那边只多了 7 行与现有完全同形的 `item()`。

**命令描述指向 `menu.help.*` 而不是新造 `commands.help.*`**:菜单在 10 个语言里
已经用**恰好这些词**命名了每一条链接,再造一套等于 70 条说同样话、还会各自漂移的翻译。

**`menu.help.checkUpdates` 有意不加**:自动更新还没实现,加一个点了没反应的菜单项
比没有更糟。

### 两个承诺了做不到的事的开关（第 48 轮）

顺着要求 #1 查渲染层还有没有会开新窗口的路径。结论是没有——「新建窗口」在桥里
已被有意做成开新标签页(带注释)。**但设置界面里「在新窗口中打开文件/文件夹」两个开关
在 Tauri 下完全无效**:渲染层从不读这两个偏好,桥也刻意不读。
用户拨动它,什么都不会发生。已按 `isTauri` 隐藏(Electron 构建仍然生效,不是删除)。

**差点带出一个静默 bug**:`isTauri` 是**函数不是布尔值**,`v-if="!isTauri"` 判的是函数对象、
恒为真,于是**两个开关在 Electron 构建里也会一起消失**。`!fn` 是合法 TS,
编译器和 vue-tsc 都不会响——只有去跑那个你并没打算改的构建才会发现。
`is-tauri-in-templates.spec.ts` 现在扫描**全部 .vue 模板**,禁止裸用 `isTauri`。已做变异验证。

### 大文件:瓶颈定位到了（第 48–49 轮）

**约 850 KB(1200 小节)的文档,在 CI 里让渲染层饱和超过 105 秒**——用例把超时抬到 105 秒
仍然超时,`console.log` 都没轮到执行,`afterAll` 关窗也超时。不是"慢一点",是**不响应**。

第 48 轮我把嫌疑记成"每次变更两次全文档 `deepClone`"。**那是错的,本地基准直接推翻了它。**
在 muya 里逐项量过(happy-dom,绝对值偏慢,看倍率):

| 嫌疑 | 实测(782 KB) | 结论 |
|---|---|---|
| 解析 | 52 ms | 排除 |
| `dispatch` 的两次 `deepClone` | 合计 42 ms | **排除**(与 105 秒差三个数量级) |
| `path` / `LinkedList.offset`(O(兄弟数)) | 整次 init 只调用 **5 次** | 排除 |

真正的位置是 **`Muya.init()` 里建块树那一段,且只对容器块超线性**:

| 文档形状 | 200 小节 | 400 小节 | 倍率 |
|---|---|---|---|
| 标题+段落 | 1331 ms | 2710 ms | 2.0×(线性) |
| 引用 | 428 ms | 1330 ms | 3.1× |
| **无序列表** | **1839 ms** | **6255 ms** | **3.4×** |

列表最糟:400 小节的三项列表**只有 15 KB**,却要 6.3 秒。另一个佐证:同样 200 个列表,
放一份文档要 2021 ms,拆成 200 份各含一个列表(每份都付完整 init 开销)反而只要 1316 ms——
**单块成本随文档规模增长**。

`src/block/__tests__/largeDocumentOpen.spec.ts` 记录了这些数字(只打印不断言阈值,
理由同 `largeDocumentParse.spec.ts`:够紧的阈值会在忙碌的 runner 上误报)。

**已找到并修好(第 49 轮)**:`InlineRenderer.patch()` **每绘制一个内容块**就调一次
`_collectReferenceDefinitions()`,而它先做一次全文档 `deepClone`、再遍历整篇文档。
计数证据很干净:100 小节时 `deepClone` 被调 **402 次、克隆 1,168,212 个节点**;
200 小节时 **802 次、4,656,412 个节点**——**调用次数线性、克隆总量翻四倍**,正是 O(N²)。
列表最糟只是因为它是容器块,一节三项列表要绘制好几个块。

链接引用定义是**文档**的属性,不是"正在绘制的那个块"的属性,所以按文档版本缓存:

| 形状 | 修复前 | 修复后 |
|---|---|---|
| 段落 x200 | 1103 ms | 844 ms |
| 列表 x200 | 1699 ms | **183 ms** |

`deepClone` 调用从 802 次降到 **2 次**。

**缓存的键是 `JSONState.version`,不是 `json-change` 事件——这一点是被测试逼出来的。**
我最初用事件失效,`referenceDefinitionCache.spec.ts` 立刻挂了:`setContent` 会
**先重建并重绘整棵树、再发事件**,于是那次真正需要新定义的重绘用的还是旧的 map。
版本号从根上消除这个时序问题。

**真实 Chromium 窗口的前后对比(E2E 打印)**:210 KB / 300 小节
**13899 ms → 3231 ms**(4.3 倍)。这是 happy-dom 之外的独立佐证。

**打字仍然慢,是另一条路径**:5 次击键 859 → 920 ms,约 180 ms/次。
桌面端的 `json-change` 处理器每次击键要走好几遍全文档——`getMarkdown()` 序列化全文、
`muyaWordCount()` 扫全文、`getTOC()`、`makeSyntheticHistory()`。
第 50 轮先摘掉了其中**纯浪费**的一项:`blocks: editor.getState()`(一次全文档深拷贝)
**没有任何读者**——编辑器、store、`sourceCode.vue`(只负责清空)、
以及真正持久化的 `createBufferedTabState` 都不读它。已端到端删除。
第 51 轮又摘掉一项:保存/脏标记的文档签名原本是**逐字符 BigInt** 的 FNV-1a
(200 KB 27 ms、800 KB 98 ms),改成两条 32 位 `Math.imul` 通道(0 ms / 3 ms)。
**这不是等价替换**:两条 32 位通道不等于一个真 64 位哈希,通道并非可证独立;
判断是对本用途仍远远够用(映射只活一个会话、每个不同快照一条)。取舍写在注释里。

**真实窗口的三点轨迹(E2E 打印,210 KB / 300 小节):**

| 指标 | 基线 | 引用定义修复后 | +签名/blocks 修复后 |
|---|---|---|---|
| 渲染 | 13899 ms | 3231 ms | **2214 ms** |
| 5 次击键 | 859 ms | 920 ms | **596 ms** |

**仍剩约 119 ms/击键(210 KB),尚未定位。** 已量过并排除的:
单块重绘 0.1 ms(与文档规模无关)、`getMarkdown()` 6.9 ms、`getTOC()` 5.6 ms、
`wordCount()` 8.2 ms;也查过没有 `deep: true` 侦听器。
已识别项合计约 21 ms,**剩下约 100 ms 不知道在哪**。

**第 52 轮做了 profiling,结果是一条否定的结论,值得写下来。**
在 happy-dom 里量 muya 自己的击键路径,得到 36 KB 10.9 ms / 72 KB 33.2 ms / 146 KB 73.3 ms,
外推到 210 KB 正好约 100 ms——看上去严丝合缝。**但 CPU profile 显示这是假象**:

| 占比 | 函数 |
|---|---|
| 37.7% | `get firstChild`(happy-dom) |
| 37.5% | `compareBoundaryPointsPosition`(happy-dom Range) |
| 13.5% | `get nextSibling`(happy-dom) |

**约 89% 是 happy-dom 自身的 DOM/Range 实现**,它的 `compareBoundaryPoints` 靠遍历兄弟节点、
是 O(N);真实浏览器用原生实现,是 O(深度)。`structuredClone` 只占 4.2%。

**结论:happy-dom 里的击键计时不能当作真实浏览器的代理**,那条"muya 击键路径是 O(文档)"的
推论不成立,已撤回。**打开文档的计时不受此影响**(那一段的瓶颈是纯 JS 的收集与克隆,已验证并修复)。

**下一步**:要量真实浏览器里的击键,只有两条路——桌面 E2E(只给总数)或
`packages/muya/e2e`(真实 Chromium,可加探针)。不要再在 happy-dom 里量击键。

### 真实浏览器 profile 的答案(第 54 轮)

`keystroke-profile.spec.ts` 用 CDP 在真实渲染层里采样(210 KB,连打十字符,1673 ms)。
前 12 项里 11 项是同一个来源:

| 占比 | 函数 |
|---|---|
| 6.2% | `deepClone` |
| 5.1 / 5.0 / 4.9 / 4.7 / 4.7% | `isArrayBuffer` / `isMap` / `isWeakSet` / `isSet` / `isWeakMap` |
| 4.4 / 4.1 / 4.1 / 3.9 / 3.9% | `tryDateGetDayCall` / `tryStringObject` / `booleanBrandCheck` / `tryBigIntObject` / `tryNumberObject` |
| 0.9% | `objEquiv` |

这是 **`deep-equal` 这个包的特征调用签名**,合计**超过 40%**。
它只在一个地方被用到:store 里每次击键都跑的那行 TOC 比较
`!equal(toc, this.listToc)`——比较的是一组扁平对象,字段只有字符串和数字。

已换成 `util/listToTree.ts` 里的 `sameHeadings`(逐键 `Object.is`)。
**取舍写在注释和用例里**:它比 `deep-equal` 更严格,结构相同但引用不同的嵌套值会被判为"不同"。
这个方向是安全的——误判"变了"只多算一次 TOC,误判"没变"才会让侧栏留在旧状态。

**效果(真实窗口)**:10 次击键(带 profiler)**1673 → 796 ms**;
5 次击键 **596 → 451 ms**(约 90 ms/击键)。新 profile 里 `deep-equal` 已完全消失,
`deepClone` 升为最大的 JS 项(12.9%)——第 55 轮已砍掉它的一半
(`dispatch` 里那份没人读的 `doc`)。

**一个读数陷阱**:同一次运行里渲染耗时从 2214 变成 3313 ms,看着像回归,**其实不是**。
E2E 用 2 个 worker 并行,而当时 profiling 探针和渲染计时是**两个文件**、各自打开 210 KB,
**互相抢 CPU**。已把探针并入 `large-document-render.spec.ts`——同文件内串行,
顺带省掉重复打开。**以后加性能用例要留意这一点。**

**第 56 轮**:移除 `doc` 后 `deepClone` 由 12.9% 降到 **9.2%**(墙钟仍在噪声内,
因为它只占整体一小块)。顺着 profile 又找到一处纯浪费:
`getMarkdown()` 是 `getMarkdownFromState(this.getState())`——**先克隆全文档再序列化,而序列化只读**。
改为直接读内部状态。

**这是碰序列化核心路径的改动,所以用测试来证明而不是靠肉眼**:
`getMarkdownNoClone.spec.ts` 拿一份含 front matter、嵌套列表、任务列表、表格、
引用、代码块的文档,序列化后断言状态逐字节未变,并断言重复调用结果一致。
全量 1452 单测 + 1347 条一致性用例通过。

**击键路径上现在只剩 `prevDoc` 一次克隆**——撤销要拿"当时的文档"求逆操作,这一次是必需的。
editor 里其余三处 `getState()` 分别在错误恢复、撤销重做、文档加载路径上,不在击键路径。

**打字延迟的完整轨迹(真实窗口,210 KB / 300 小节,每次 5 击键)**:

| 阶段 | 5 击键 | 约每击键 |
|---|---|---|
| 基线 | 859 ms | 172 ms |
| 引用定义按版本缓存 | 920 ms | 184 ms(未动打字路径) |
| 文档签名换 `Math.imul` + 删 `blocks` | 596 ms | 119 ms |
| TOC 比较去掉 `deep-equal` | 451 ms | 90 ms |
| 删 `dispatch` 里没人读的 `doc` | 458 ms | 92 ms(噪声内) |
| `getMarkdown()` 不再克隆 | 346 ms | 69 ms |
| `wordCount` 单遍化 | **223 ms** | **45 ms** |

合计约 **3.8 倍**。`deepClone` 在 profile 里由 12.9% 降到 **5.3%**,
剩下的是 `prevDoc`(撤销必需)。当前 profile:`(program)` 68.7%、`deepClone` 5.3%、
`wordCount` 3.7%、`offset` 2.0%——**JS 侧能捞的基本捞完,剩下是浏览器原生的 DOM/布局**。

**遗留**:`deep-equal` 已无源码引用(未 import 的依赖不进打包,运行时收益已拿到),
但 `package.json` 里的声明还在。清理要动 lockfile,而本机 `pnpm install` 会触发
下载 Electron 的 postinstall,不值得在这里冒险。

### 自定义键位:有意不实现(第 53 轮查证)

`mt::keybinding-save-user-keybindings` 一直记在缺口里。查证后**决定不做**,理由:

Tauri 侧的快捷键来自三处——Rust 菜单里**硬编码**的加速键、桥里 `installTabShortcuts` 的
固定键位、以及 muya 自己的内部键位。上游保存后还会**重建菜单加速键并广播**给所有窗口,
而 Rust 菜单是启动时一次性构建的。
所以只实现"保存到文件"会得到一个**存得下、不生效**的设置面板——
比现在更糟,和第 48 轮隐藏那两个"在新窗口打开"开关是同一类判断。

**现状是诚实的**:桥没有路由这个 invoke,`save()` 拿到 `undefined` 返回 false,
面板弹出「保存失败」提示。用户看到的是失败,不是假装成功。

要真做,先决条件是 Rust 侧能在运行时重建菜单加速键;那之后再接存储才有意义。

### 「秒启动」和「占用低」第一次被量(第 57 轮)

要求 #8 里这两项此前**只用打包体积论证过,没有量过时间和内存**。
`large-document-render.spec.ts` 现在一并量:

- **启动**:读渲染层自己的导航时间轴(`domContentLoadedEventEnd` / `loadEventEnd` /
  编辑器可用时的 `performance.now()`)。**量的是渲染层那一半**,不是整个启动——
  `launchElectron` 自己 sleep 了 500 ms,进程拉起又属于 Electron(而本项目要发的是 Tauri)。
  渲染层这一半正是 bundle 优化针对的部分,也是**原样带到 Tauri 的部分**。
- **内存**:`performance.memory.usedJSHeapSize`,空白时与载入 210 KB 后各取一次。

**都不设紧阈值**:CI runner 波动太大,紧到能抓回归的阈值会在忙碌 runner 上误报,
而误报会教人忽略它。数字打印出来,断言只拦崩塌(启动 30 s、堆增长 400 MB)。

五条用例合并在同一文件、共用一个应用和一份文档——**上一轮的教训**:
两个文件各自打开 210 KB 会互相抢 CPU,量到的是对方的负载。

### 「秒启动」「占用低」的第一组真实数字(第 58 轮)

真实窗口(Electron,CI runner):

| 指标 | 值 |
|---|---|
| DOMContentLoaded | 334 ms |
| load | 351 ms |
| **编辑器可用** | **925 ms** |
| JS 堆(空白) | 17 MB |
| JS 堆(载入 210 KB 后) | 17 MB |

**口径必须说清**:
1. 这是**渲染层那一半**——`launchElectron` 自己 sleep 500 ms,进程拉起属于 Electron。
2. `performance.memory` **只统计 JS 堆**,不含 DOM 节点(C++ 对象)和渲染进程 RSS。
   要量真实占用需要进程级 RSS,当前 E2E 拿不到。
3. **那组「17 / 17 MB」其实什么也没说明,已弃用**:载入 139 KB(1400 个块对象)不可能零增长,
   `performance.memory` 为防指纹被**量化**过——精度低到足以给出一个"看着可引用、实则无意义"的数。
   第 60 轮改用 CDP 的 `HeapProfiler.collectGarbage` + `Runtime.getHeapUsage`:不量化,
   且先强制回收,量的是**真正被持有的**而不是尚未清扫的。

**真实数字(139 KB / 200 小节)**:空白 **11 MB**,载入后 **15.3 MB**——文档约 **4.3 MB**,
约为源文本的 31 倍(块树 + JSON 状态副本,量级合理)。断言上限据此由 `+400 MB` 收到 `+60 MB`:
留一个数量级余量,既不会被 runner 波动误伤,又能在泄漏或多留一份副本时报警。

### 我的重用例把别的用例挤垮了(同轮)

同一次运行里 `all-blocks-roundtrip` 的"脏编辑保存"挂了——`isDirty` 5 秒轮询超时。
**不是逻辑回归**:那次哈希改动之后已连续三次运行通过,而这两次之间只加了启动/内存量测。
是 2 worker 并行下,这个文件(开 210 KB + profiling)抢走了 CPU。

已减负:小节数 300 → **200**(128 KB),profiling 打字 10 → 5 字符。
**一个让整套测试变脆的测量,不值那点精度。** 这是同一个坑的第三次:
先是两个性能文件互抢,再是并入一个文件,现在是它整体太重。

### 一次有界的排查 + 自动保存进菜单(第 59 轮)

**同类崩溃扫干净了**:未路由的 invoke 返回 `undefined`,调用方若假设结果形状就会抛异常。
渲染层共 9 处 `ipcRenderer.invoke`,逐个核对后——其余 8 处要么不用结果、要么已路由、
要么把 `undefined` 当 false(键位面板"保存失败"正是这个,且是诚实行为)。
**只有拼写检查面板一处,已修。** 记下来免得再扫一遍。

**文件 → 自动保存**已补进两套菜单。上游有、`mt::cmd-toggle-autosave` 已路由、
自绘菜单栏的勾选态从 `autoSave` 偏好实时读(不是自持标志,不会漂移)。

**「窗口置顶」没做**:通道其实已路由(计数把它记成缺失是过时的),但自绘菜单栏
**根本没有 Window 段**——无边框窗口的最小化/最大化/关闭由标题栏按钮提供。
为一个「置顶」单开一个只有一项的 Window 菜单不合适,而 `menu-parity.spec.ts` 要求两套菜单
条目一致,所以不能只加原生那边。留待与 Window 段整体一起考虑。

### `wordCount` 单遍化,以及一次被测量否决的"优化"(第 62 轮)

profile 里 `wordCount` 占 3.7%,它每次击键要做三四次全文档分配:正则复制一份去掉 CJK 的文本、
切出几万个 token、再 filter、再 reduce。改成单遍统计。

**第一版更慢**:200 KB 由 4.8 ms 变成 **7.6 ms**。原因是我对每个字符做 `md[i]` 取子串再跑 `/\s/` ——
V8 的 `split`/`replace` 是高度优化的原生代码,而逐字符进正则引擎并分配单字符串远比它贵。
**"少分配就更快"是直觉,不是事实。** 换成字符码判断后才真正变快:

| 文档 | 原实现 | 新实现 |
|---|---|---|
| 200 KB | 6.6 ms | **1.4 ms** |
| 800 KB | 27.8 ms | **8.0 ms** |

**语义用差分测试锁住**:把原实现原样留作 oracle,对 24 个边界用例 + 300 份确定性生成的文档
逐一比对四个计数。其中一条反直觉的规则被单独写成用例:
原实现是"先删掉 CJK 再按空白切分",所以 **CJK 字符不打断它两侧的 token**——`ab中cd` 是一个 token。
这种规则靠读代码很容易改错,靠差分测试才能保住。

### 打不开的文件不再静默(第 64 轮)

真缺口里挑了 `mt::show-notification`。桥答 `mt::open-file` 时读盘失败(文件没了、无权限、
或是二进制)只写 `console.warn` 就返回——**用户点了文件树或最近列表里的一项,什么也不会发生**,
连"这一下有没有点中"都无从判断。上游由主进程经这个通道提示;没有主进程,就由桥来提示。

**watcher 自己的读取失败有意保持静默**,这个不对称写进了用例:
文件在变更事件与读取之间被删是**常态**,unlink 事件马上就到——每次重命名/删除都弹一次会刷屏。

新增两条 i18n 键、10 个语言都补齐(`locale-parity.spec.ts` 要求键集完全一致)。
只造一对通用的"无法读取文件 / {path} 读取失败:{msg}",而不是给"打开失败"和"重读失败"
各造一套——**翻译面越小,漂移越少**。葡语按仓库既有用词选了 arquivo(巴西变体)而非 ficheiro。

### Window 菜单段:缩放与置顶(第 65 轮)

第 59 轮把这两项一起搁置了,理由是**自绘菜单栏没有 Window 段**,而
`menu-parity.spec.ts` 不允许只加原生那边。这轮一起做完:两套菜单都新增 Window 段,
含缩放放大/缩小、窗口置顶。自绘那边只列命令——**它只在无边框窗口渲染,
最小化/最大化/关闭由标题栏按钮提供**,原生那边仍用系统预定义项。

缩放的步进照抄上游主进程(`min(2.0, zoom+0.125)` / `max(0.5, zoom-0.125)`),
只是当前值改从渲染层已有的 `zoom` 偏好读——没有主进程可问。

**差点加了三条重复键**:`descriptions.ts` 里**早就预留了**
`window.zoomIn` / `window.zoomOut` / `window.toggle-always-on-top` 三条映射,
指向 `commands.window.*`,而那三条文案 10 个语言里也都在。
我最初按 kebab 命名(`window.zoom-in`)并另指 `menu.window.*`,等于**同一个功能两套命名**。
改用映射表预期的 id 后,描述文件一行都不用动(diff 为空)。
**加东西之前先读一遍现有的表。**

### 首屏体积的真实构成(第 67 轮)

之前只知道首屏是 2445 KB 一整块,不知道里面是什么(压缩后包名不可见)。
**用 sourcemap 解码 mappings、把生成后的字节归因到来源**——这是准确的口径:

| KB | 来源 |
|---|---|
| 715 | `packages/muya`(编辑器引擎,必需) |
| 291 | 应用源码 |
| 288 | element-plus |
| **285** | **katex** |
| **170** | **@marktext/file-icons** |
| 45 | axios |
| 44 | prismjs |
| 41 | marked |

复现方法:`pnpm exec vite build --config vite.tauri.config.ts --sourcemap`,
再解码 `index-*.js.map` 的 mappings 按 `sources` 聚合(sourcesContent 不存在,只能走 mappings)。

**已摘掉 axios(45 KB)**:它只在 `main.ts` 里挂了个 `app.config.globalProperties.$http`,
**从未被读取**——Vue 2 时代的写法。连同那个 4 行的 `axios/index.ts` 一并删除;
将来做图床上传时直接 import 即可,没必要留一个没有消费方的模块烂在那里。
首屏 2445 → **2400 KB**。

**element-plus 288 KB:已拆分,首屏 2229 → 2088 KB(省 141 KB)。**
按 `<el-…>` 标签统计,10 个组件**只有设置窗口用**(含最重的 `el-table` / `el-select`),
却在 `main.ts` 里为两个窗口全局注册。改为设置树加载时才注册
(`prefComponents/settingsComponents.ts`,在 `preference.vue` 的 setup 里调用——
setup 早于自身与路由子组件的渲染,而 Vue 是在渲染时解析标签的)。

**先做了一次"临时删掉再量"的实验**才动手:确认省 141 KB 之后才写正式实现。

**这个拆分会引入静默故障**:编辑器里写 `<el-input>` 会解析不到,Vue 只在控制台警告、
控件直接不显示。所以配了 `element-plus-registration.spec.ts`,
**拿两棵树里真实出现的 `<el-…>` 标签去对账两份注册清单**(四条:编辑器标签全覆盖、
设置标签全覆盖、延后集合不出现在编辑器、两份清单不重叠)。
CLAUDE.md 里"加 `<el-…>` 要同步 main.ts"的告诫,现在由测试强制执行。

**SVG 图标 sprite:42 个定义、只有 2 个被引用,已裁剪(46 → 4.2 KB)。**
它在启动时注入 DOM,**不能延后**(必须早于首个 `<use>` 渲染,而那些图标首屏可见),
所以能做的只有裁剪。**删之前先排除了动态拼接**(`'#icon-' + name` 这类 grep 抓不到),
并把这条前提写成断言——`symbol-icons.spec.ts` 三条:引用的都有定义、定义的都被引用、
**所有引用都是字面量**(最后一条正是"扫描裁剪"这个手法成立的前提)。

**muya 内部构成(同样用 sourcemap 归因)**:`config/emojis.ts` **179 KB**,是 muya 贡献里最大的单项。
它在**同步解析路径**上——`validEmoji` 要在分词与渲染时判断 `:alias:` 是否有效——所以不能整体延后。
但两个调用方**只需要"别名是否有效"和"那个表情字符"**;`description` / `category` / `tags` 只有选择器的模糊搜索用。
于是拆成两份:`config/emojiAliases.ts`(52 KB,别名 → 字符)供同步路径,完整表由选择器**按需加载**。

**两份数据必然漂移,所以配了守卫**:`emojiAliases.spec.ts` 从完整表**推导**出别名映射再比对
(含"首个别名优先"这条原 `find` 语义)。表更新而映射没重新生成,会在这里失败,
而不是悄悄认不出 `:some_new_alias:`。

选择器的用例改动也值得一提:**7 条用例主体一行未改**——只在 `beforeEach` 里等表加载一次。
`emojisForSearch` 是模块级状态,等一次之后同步搜索照常工作,**正如真实应用里从第二个 `:` 起的情形**。

### 新用例第一跑就失败,而且抓对了(第 71 轮)

我补的那条"弹窗真的给出建议"在 muya E2E 里**直接失败**(10 秒内条目为 0)。查因:

1. **我的代码有个设计缺陷**:动态 import 失败时 `catch` 把错误吞了,表永远为空、**且无迹可寻**。已改为记日志。
2. **真正的原因是纯延后加载的时机**:muya 的 e2e 宿主页跑 **Vite dev server + 源码**,
   首次动态 import 那个 **12982 行**的 TS 模块要即时转译——生产构建里它是预打好的 chunk,没有这个代价。

**没有把超时调大了事**,而是改成更好的设计:**选择器构造时在空闲(`requestIdleCallback`)预取**。
首屏仍不含它(1901 KB 不变),而用户第一次输入 `:` 时表已就位——**纯延后加载会让首次使用去和一个大模块赛跑**。
用例保留轮询并放宽超时,注释写明那是 dev server 的转译代价、真实应用没有。

### 我加的那条用例撤回了,理由要说清(第 73 轮)

第 71 轮补的"弹窗真的给出建议"在 muya E2E 里连挂两次:改成空闲预取后**仍然 0 条目**,
25 秒轮询也一样。**预取没解决,说明问题不在加载时机。**

对照证据:muya **单测**里有一条"按分类分组、每个表情渲染一个 `.item`",
在 happy-dom 里通过——**搜索与渲染逻辑是好的,含延后加载**。
所以缺口在 e2e 那条"打字 → 事件"的链路上,**而原用例的注释早就写明它不稳定**
("有些运行能看到填充,有些看到空的过滤结果")。

**结论:我加的是一条这个环境本来就产不出的断言,不是我的改动破坏了什么。**
已撤回,并把这段判断留在用例文件顶部(而不是只写在提交信息里):
说明为什么这里只断言容器存在、以及填充在哪里被覆盖。

**保留的是两处真正的改进**:空闲预取(首次使用不再和大模块赛跑)、以及**不再吞掉 import 错误**。

**表情选择器的行为变化配了真实浏览器验证**:`packages/muya/e2e/` 跑真实 Chromium,
且 `muya-e2e.yml` 的触发路径**包含 `packages/muya/src/**`**,所以这个改动会被它跑到。
但查证后发现既有的 `inline/emoji.spec.ts` **有意写得很宽松**(只断言弹窗 DOM 存在,
注释说明"填充状态本来就不稳定")——也就是说"弹窗真的给出建议"从来没被验证过,
而那正是延后加载最可能破坏的属性。已补一条用 `expect.poll` 的用例,
**轮询正好覆盖动态 import 的到货时间**,一次性读取则是在和它赛跑。

**首屏轨迹**:3512 → 2494 → 2445(去 deep-equal)→ 2400(去 axios)→ 2229(file-icons)
→ 2088(element-plus 拆分)→ 2049(图标裁剪)→ **1901 KB**(表情表拆分),累计 **−46%**。

**但要说清楚:启动墙钟时间看不出改善。** 五次运行分别是
925 / 979 / 1050 / 1136 / 1152 ms,**runner 波动 ±20%,瘦身的信号淹没在噪声里**。
可以确认的是字节数和 JS 堆(空白 11 → 9.9 MB)确实降了。
要断言"秒启动"仍需在 Tauri 产物上量整个进程,并多次取中位数。

**两个更大的候选,都有代价,先记不动:**
- **katex 285 KB**:muya 里 3 处静态 import(`inlineMath` / `marked/extensions/math` / `mathPreview`),
  而渲染是**同步产出 HTML 字符串**的。改成动态 import 会波及引擎架构,
  且公式会变成"先占位、后替换"的可见行为变化。
- ~~**file-icons 170 KB**~~ **已摘掉,首屏 2400 → 2229 KB**。
  它有**两个**引入方,只改一个毫无效果(我先只改了桌面侧,首屏纹丝不动):
  1. 桌面 `sideBar/icon.vue` —— 只在**项目树**的文件行用;抽屉默认显示的是最近文件,
     那些行不带文件图标,所以没打开文件夹就根本不渲染。改为 `defineAsyncComponent`,
     并给一个等宽占位,避免展开文件夹时文件名横向抖动。
  2. muya `ui/utils/fileIcons.ts` —— 唯一消费方是 `codeBlockLanguageSelector`(选代码块语言的弹窗)。
     改为**首次渲染该弹窗时**才动态引入,到货后重渲一次;渲染保持同步,拿不到就先不画图标。
     `loadFileIcons` 在拿到模块后即为空操作,所以重渲不会递归。

### 旧引擎的最后一根线已拆(第 72 轮)

扫未引用依赖时(上次靠它找到 axios)顺带查实:**`packages/muyajs` 在桌面端已经零调用点**——
源码与测试里没有任何 `muya/...` 导入,只剩一处类型声明里的注释。文档一直写着"只剩少量调用点",
实际是一个都没有了。

已清掉:4 个配置文件里的 `muya` 别名(共 5 处)、以及给 `muya/lib/*` 写的环境声明 `src/types/muya.d.ts`。

**别名才是重点**。留着它就是一条通往退役引擎的**可用**路径:import 能解析、能通过类型检查、
能把第二个编辑器打进包里,而没有任何东西会反对。`legacy-engine-retired.spec.ts` 三条:
无处导入、无别名可达、**且新引擎 `@muyajs/core` 的路径映射仍在**(第三条是必要的——
目标是"只剩一个 muya",不是"没有 muya")。

**遗留**:`@marktext/muyajs` 仍在 `package.json` 的 dependencies 里。清它要动 lockfile,
而本机 `pnpm install` 会触发下载 Electron 的 postinstall。**未 import 的依赖不进打包**,
所以这只是清单卫生问题,不影响体积。

### 启动埋点(第 75 轮,回应"3 秒"的反馈)

用户报告:双击图标到首次看到文件内容约 **3 秒**,上游 Electron 版同为 3 秒,
Flutter 版不到 1 秒。

**先厘清能测到什么**:E2E 量到渲染层那一半约 1 秒(导航开始 → 编辑器可用),
首屏字节这几轮已由 3512 KB 降到 1901 KB。剩下约 2 秒在**第一行 JS 之前**——
进程拉起、插件注册、菜单构建、WebView 创建——**本机没有 webkit2gtk,量不到**。

审查过渲染层挂载前的串行等待,只有两处:`boot_info` 一次 IPC(它顺带把首个文件的内容
一起带回,这条路径是紧的)、以及非英文时的语言包加载。**量级不足以解释 2 秒。**

所以加了两侧埋点,便于一次运行就定位:
- **Rust**:`setup entered` / `menu built`,相对进程启动,打到 stderr(终端启动可见)。
- **渲染层**:`shell bridge` / `mounted` / `editor ready`,相对 `performance.timeOrigin`,
  一行 console + `window.__MT_STARTUP__`。

**两者相减即为 JS 之前的开销**——这正是目前唯一看不见的一段。

**用户在 Windows 上跑了 Tauri 版并给回日志(第 77 轮),拆解如下:**

| 区间 | 耗时 | 是什么 |
|---|---|---|
| 0 → 1273 ms | **1273 ms(55%)** | 进程拉起 + 插件初始化 + **WebView2 启动** |
| → 1341 ms | 68 ms | 构建菜单(含读语言包) |
| → 1713 ms | 372 ms | 页面加载 + JS 解析执行 + `boot_info` 往返 |
| → 1725 ms | 12 ms | 读首个 md 文件 |
| → 1756 ms | 31 ms | Vue 挂载 |
| → 2306 ms | **550 ms** | muya 建编辑器 + 渲染文档 |

渲染层自己的时钟可反推:**导航开始于 +1235 ms**——WebView 直到 1.2 秒后才开始加载页面。

**结论一(不可控)**:最大的一块在第一行 JS 之前,是 WebView2 运行时起来的时间。
这也解释了上游 Electron 版同为 3 秒(它起 Chromium),而 Flutter 版 <1 秒——**它没有浏览器引擎**。
**这是 Web 技术栈的地板,不是本项目的实现问题。**

**结论二(可控)**:JS 那 372 ms 与编辑器初始化那 550 ms 合计约 0.9 秒,是我们能动的部分。
首屏字节已由 3512 KB 降到 1901 KB,直接作用于前者。

**已加更细的埋点,下一份日志可再拆两处**:
`plugins ready`(插件初始化 vs 窗口/WebView 创建,用注册在最后的探针插件实现——
插件按注册顺序初始化)、`script start`(JS 解析 vs 等 `boot_info` 往返)、
`engine constructed`(建引擎 vs 渲染文档)。

**读下一份日志前先量好了引擎自身的地板**(muya 的真实 Chromium harness,
`new Muya + init()` 热态,即模块已解析完毕之后的纯执行):

| 文档 | 构造 + init |
|---|---|
| 1 标题 + 1 段(24 B) | **7.6 ms** |
| ~4.4 KB | **51.6 ms** |
| ~90 KB | **712 ms** |

这张表是下一份日志的判读钥匙。`engine constructed → editor ready` 这一段:

- 若为 ~10 ms 量级 → 550 ms 花在**构造之前**(Vue 渲染完到编辑器组件真正开工之间),
  届时再补一个 `editor mounting` 埋点即可定位;
- 若接近 550 ms → 用户开的是个大文件,成本在渲染文档本身,属已知的大文件路径。

顺带排除了一个先入为主的猜测:编辑器组件是**静态导入**的(全仓仅
`sourceCode.vue` 与 `FileIcon` 走 `defineAsyncComponent`),所以这 550 ms
不可能是"异步块加载",引擎在第一行 JS 跑之前就已解析完毕。

**本机跑不了桌面端 E2E**(无 Xvfb,native-keymap 的 .node 也不在),
所以渲染层的启动分解只能靠用户回传日志 + muya harness 侧证,不能本机复现。

### 第二份日志(第 80 轮),三处细化埋点都到位

| 区间 | 耗时 | 是什么 |
|---|---|---|
| 0 → 57 ms | 57 ms | 进程拉起 + 插件初始化 |
| 57 → 1075 ms | **1018 ms** | 窗口创建 + **WebView2 启动** |
| 1075 → 1132 ms | 57 ms | 构建菜单 |
| *导航开始于 1036 ms* | | |
| 导航 → script start | **532 ms** | HTML + 打包体的取用与求值 |
| → shell bridge | 44 ms | `boot_info` 往返 |
| → mounted | 12 ms | Vue 挂载 |
| → engine about to build | **326 ms** | Vue 渲染完到编辑器组件开工 |
| → editor ready | **393 ms** | 建引擎 + init + 渲染文档 |

**`plugins ready` 只有 57 ms,坐实了那 1 秒是 WebView2 而非本项目的插件初始化。**

**一个被证伪的猜测**:怀疑 393 ms 花在 `muya.init()` 同步实例化 16 个 UI 插件上
(表情、表格、图片工具等交互才用得到)。用 harness 量了:带插件 6.7 ms、
去掉插件 3.9 ms,**差值仅 2.8 ms**。不是这里。冷启动的首屏样式/布局/字体
本机复现不了,只能继续靠日志。

**据此再加两处埋点**:
`document fetched` / `bundle fetched` 由 Timing API 读出(不是手打的时钟),
把 532 ms 拆成"取"与"编译执行"——两者的修法相反;
`editor mounting` 把 326 ms 拆成"等编辑器组件出现"与"编辑器自己的准备"。
同时把 `engine constructed` 改名为 `engine about to build`:它标在 `new Muya`
**之前**,旧名字会把读日志的人引向反方向。

### 大文件路径:一条很像答案的假线索(已排除)

对 90 KB 文档的构造做 CPU profile,自身耗时榜首是 **`addRange` 29.7%**——
即 `Selection.addRange`,浏览器的光标 API。"渲染一篇还没获得焦点的文档,
三成时间花在设置选区上"听起来就是个 bug。

**数了调用次数:整篇文档只调 1 次**,但单次开销随文档线性增长
(20 块 2 ms → 2400 块 122 ms)。它不是被调滥了,而是
**一次调用强制同步布局了整篇文档**。

于是问真正该问的问题:这次布局是白做的,还是本来就要做?
把 `addRange` / `extend` 打桩成空操作,量**到首帧**(双 rAF)的总时间:

| 块数 | 带光标定位 | 去掉光标定位 |
|---|---|---|
| 800 | build 92 ms / painted **117 ms** | build 91 ms / painted **117 ms** |
| 2400 | build 258 ms / painted **307 ms** | build 297 ms / painted **337 ms** |

**到首帧没有任何差别。** 那次布局只是被提前了,不是被浪费了;
去掉它只会把时间挪到绘制阶段。改动放弃。

**教训**:profile 的 self time 落在会强制同步布局的 DOM API 上时,
不能直接当成可回收的开销——要拿**到首帧**的口径复核,否则就是把时间
从一个计时器搬到另一个计时器。muya 的大文件路径已接近本架构的地板,
再往下需要虚拟化(只渲染可视区块),那是架构级改动。

### 第三份日志(第 82 轮):356 ms 全在「等编辑器出场」

| 区间 | 本次 | 上次 |
|---|---|---|
| 进程拉起 + 插件初始化 | 60 ms | 57 ms |
| 窗口创建 + **WebView2 启动** | **1227 ms** | 1018 ms |
| 构建菜单 | 87 ms | 57 ms |

导航起于 +1253 ms。渲染侧(相对导航):

| 区间 | 耗时 | 读出的信息 |
|---|---|---|
| 取 HTML | 165 ms | |
| → 取完 1902 KB 打包体 | +125 ms(累计 290) | **取字节只占 290** |
| → script start | **+253 ms**(累计 543) | 上一轮那 532 ms 拆开了:**一半是编译/求值,不是下载** |
| → shell bridge | 58 ms | `boot_info` 往返(Rust 侧读文件 14 ms) |
| → mounted | 15 ms | Vue 挂载 |
| → **editor mounting** | **356 ms** | ← 上一轮那 326 ms **全在这里** |
| → engine about to build | **2 ms** | 编辑器组件自己的准备约等于零 |
| → editor ready | **406 ms** | 建引擎 + init + 渲染文档 |

**新增埋点答对了它要答的问题**:那 326/356 ms 我原以为可能分摊在「等组件出现」与
「组件自己准备」两边,实测是 **356 : 2**。编辑器不是慢,是**没被允许开工**。

原因在 `pages/app.vue`:`<editor-with-tabs v-if="hasCurrentFile && init">`,
而 `init` 由 `onMounted` 里第 20 多行的 `LISTEN_FOR_BOOTSTRAP_WINDOW()` 才置上。
在它之前排着 `await LISTEN_COMMAND_CENTER_BUS()`(建 83 条命令的描述表)
与约 40 次 `LISTEN_*` 监听注册——**没有一件是显示文档所必需的**,
而首个文件的内容早在 +601 ms 的 `boot_info` 里就到手了。

**但不要照这个推断动手**。这一段里还叠着 `init` 翻转后 Vue 的重渲染
(侧栏在模板里排在编辑器之前,它的挂载成本也落在这 356 ms 内)。
所以本轮只加了三处埋点把 356 ms 再切成四段:`commands ready`(命令表)、
`bootstrap dispatched`(它之前的监听注册)、`listeners registered`(其余监听),
到 `editor mounting` 的剩余即为 Vue 重渲染。**下一份日志才决定改哪一段。**

**另一处可动的**:`script start` 那 253 ms 是编译/求值 1902 KB,
与「取」的修法相反——继续削首屏体积对它同样有效,而降延迟对它无效。

### 内存:线性,且比记载的低一个数量级(第 82 轮)

上一轮留下的 scratch 用例跑完了(muya 真实 Chromium harness,两次 GC 后读 `Runtime.getHeapUsage`):

| 文档 | 堆 | 增量 | 每块 | 相对源文本 |
|---|---|---|---|---|
| 空 | 8.6 MB | — | — | — |
| 593 KB(8000 节) | 23.4 MB | 14.8 MB | 970 B | 25.6× |
| 854 KB(11500 节) | 29.6 MB | 21.1 MB | 960 B | 25.2× |
| 1192 KB(16000 节) | 37.8 MB | 29.2 MB | 956 B | 25.1× |

**每块开销在 2 倍尺寸区间内是平的**——内存随文档线性,没有二次方。
按此外推 4 MB 文档约 100 MB,而本文件此前记的是「4 MB 文档解析后堆约 600 MB」。
那个数字**没有出处、也无法在这条路径上复现**;它大概量的是另一回事
(纯解析、或未 GC、或不在浏览器里)。**以上表为准,旧数字已删。**

顺带落到用例里:`packages/muya/e2e/tests/stability/heap-linearity.spec.ts`,
3000 与 6000 节两点,断言每块开销不随文档变大(容差 1.4×,实测 1019 → 979 B)。
**为什么要两点**:桌面端 `large-document-render.spec.ts` 已钉了天花板,
但只有一个尺寸(139 KB),**一个点画不出斜率**,每块开销随文档增长的回归会从它下面走过去。
用例 9.3 s,刻意选的是能把增量拉离空堆噪声的最小两档
(第 59 轮的教训:重用例会挤垮同套件其他用例的计时)。

## 下一步（按优先级）

1. **深色模式目视验收**（唯一悬着的用户要求）：本机 sudo 需密码、装不了 webkit2gtk，
   静态审查已做尽（见下）。需在有 webkit2gtk 的机器上跑 CI 产物的安装包人工确认。
2. **自动更新**（6 个通道）：需 `tauri-plugin-updater` + 签名密钥 + 更新服务器，属发布基建。
3. **拼写检查**（5 个通道）：**硬缺口**。Electron 的拼写检查是 Chromium 内置 API，
   Tauri 无对应物，要做得自带词典与算法。
4. ~~**pandoc 导入**~~ —— **已经做完了，这条记载过时**。Rust 侧
   `commands::cmd::pandoc_to_markdown` 已注册（`lib.rs:77`），桥内 `import.ts` 的
   `canImportWithPandoc` / `importWithPandoc` 已接，拖入 .docx 也走这条路。
5. **原生菜单状态回显**：自绘菜单栏已有勾选态；macOS 的原生菜单仍无，需 Rust 侧持句柄 `set_checked`。
6. ~~**E2E 覆盖要求 #4**~~ —— **这条做不到，不要再试**。E2E 跑的是 Electron，而
   **Electron 版本本来就会恢复标签页**（主进程持久化 buffered state + `startUpAction:
   'restoreAll'`）。要求 #4 只在 Tauri 侧成立：桥把 `update-buffer-state` 放进
   `IGNORED_INVOKES`，快照写出去就丢掉。这是**有意为之且已写明理由**的，
   `no-tab-restore.spec.ts` 已从两个方向锁住（写侧被忽略、读侧无 `mt::load-state`）。
   在 Electron 里断言「标签页不恢复」只会得到一个必然失败的用例。
7. **大文件的渲染侧**：解析与内存都已量到且都线性（见「内存:线性」一节，约 25× 源文本、
   每块 ~960 B）。渲染耗时在 harness 里约 11–13 ms/KB，也近似线性。**再往下要虚拟化**
   （只渲染可视区块），属架构级改动，不在本轮。
8. **首屏那 356 ms**：埋点已细化到四段，等下一份启动日志决定改哪一段（见第 82 轮）。

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
