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

**基线 2026-08-25：116 个通道，实现 18 → 当前 92，"缺" 24。**
（复测命令见本文件末尾）

**这个 24 不能直接读作"还差 24 个功能"。** 逐条查证后(第 44/53/58/59/63/83 轮),分三类:

| 类别 | 数量 | 明细 |
|---|---|---|
| **有意不实现 / 不适用** | 5 | `bootstrap-editor`(Tauri 自举)、`load-state`(标签页有意不恢复,已测)、`switch-tab-by-file_path`(应用内无触发方)、`keybinding-save-user-keybindings`、`keybinding-debug-dump-keyboard-info`(前置条件是 Rust 运行时重建加速键) |
| **计数假阳性(功能其实可用)** | 10 | `show-export-dialog`(导出菜单走命令系统)、`cm-copy-as-html` / `cm-copy-as-rich` / `cm-paste-as-plain-text` / `cm-insert-paragraph`(自绘右键菜单派发同名 bus 事件)、`spellchecker-set-enabled` / `spellchecker-switch-language` / `spelling-replace-misspelling` / `spelling-show-switch-language`(系统/WebView 负责,周边 UI 已隐藏)、`window-zoom`(见下) |
| **真缺口** | 9 | 自动更新 6(需签名密钥 + 更新服务器)、截图 2(Tauri 无对应 API)、`spellchecker-get-available-dictionaries`(无词典列表可给) |

**第 83 轮的两处订正**:
- `show-notification` 已实现(`7…` 轮补的 watcher I/O 错误提示),不再计入。
- `window-zoom` 由「真缺口:缺菜单项」改判为**计数假阳性**。查实:Rust 菜单发的是
  `cmd:window.zoomIn` / `cmd:window.zoomOut`,经命令系统到 `bus.emit('mt::window-zoom')`,
  而 `store/editor.ts` **同时**监听 bus 与 ipc 两条路。菜单项本身也早在 `891a910c` 就加了。
  这一条的记载过时了两重。

**于是「实现上游全部功能」这条轴基本关账**:剩下的 9 个真缺口里,6 个是自动更新
(属发布基建,要签名密钥和更新服务器,得先有决策),2 个截图是 Tauri 平台没有对应 API,
1 个是拿不出词典列表。**没有一条是"还没做"的普通功能。**

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
  Playwright + 真实 Electron 跑 desktop E2E 套件；`test.yml` / `lint.yml` / `muya.yml`
  同样自动运行。**推送后应当一并检查这些，而不是只看手动触发的 tauri-build。**
- **CI 已于第 114 轮清理到 7 条**（原 15 条）：删掉 `build.yml`（每个 PR 建 5 平台
  Electron 安装包，本项目不再发这个壳）、`release.yml`（Electron 发版，与 tag 抢
  Release）、`website-deploy.yml`（不是应用，且缺 `CLOUDFLARE_API_TOKEN` 必然失败）；
  muya 的 6 条合成 `muya.yml` 一条两作业。`typecheck` 由 `lint.yml` 覆盖，
  Electron 主进程由 `e2e.yml` 的 `pnpm build` 覆盖，**没有因此丢掉验证面**。
- **E2E 会被下一次推送掐掉**：`e2e.yml` 每次推 PR 自动触发、约需 13 分钟，且同样是
  `cancel-in-progress`。以每 10 分钟一次的节奏推送时，**它永远跑不完**——本会话曾连续 6 次被取消，
  唯一跑完的那次是失败的，而那个失败是编辑器窗口永久空白的真回归。
  **改动渲染层后要留出一轮不推送的时间让它跑完。**
- **触发 CI 前先确认没有正在跑的 run**：`tauri-build.yml` 配了
  `concurrency: cancel-in-progress: true`，再次 `gh workflow run` 会**直接取消上一次**，
  于是那次的验证信号就没了。等它结束再触发下一次。
- **`gh` 在 PATH 外**：二进制在 `/iflytek/workspace/znhu/github/gh_2.93.0_linux_amd64/bin/gh`，
  `~/.config/gh/hosts.yml` 里已登录。加进 PATH 即可正常用 `gh run` / `gh pr` / `gh release`。
  若哪天连二进制也没了，退回 API（token 不要回显）：

  ```bash
  TOKEN=$(grep -A5 'github.com' ~/.config/gh/hosts.yml | grep oauth_token | head -1 | sed 's/.*oauth_token: *//')
  curl -s -H "Authorization: token $TOKEN" \
    "https://api.github.com/repos/SugarFatFree/marktext-light/actions/runs?branch=feat/tauri-migration-phase1&per_page=8"
  # 失败日志：.../actions/runs/<run_id>/jobs 取 job id，再 .../actions/jobs/<job_id>/logs
  ```
- **改了 `src-tauri/**` 必须手动触发 `tauri-build.yml`,否则没有任何流水线会编译它。**
  它只在 `workflow_dispatch` 或推到 `develop` 时跑（见该文件顶部注释：4 平台 Rust 构建太贵，
  每次 PR 同步都跑会抢 runner）。**其余流水线一概不碰 Rust**——第 45 轮改完菜单差点就这么推走了。
  另外 `v*` tag 现在也会触发它，并把安装包发成正式 Release（第 114 轮）。触发方式：

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

### E2E 终于跑完一次,抓到侧栏重做漏掉的用例(第 82 轮)

推 `bebdf9bc` 后 `E2E Test` 是 **228 过 / 1 失败**,失败的
`issue-2421-sidebar-state.spec.ts` 与本轮改动(三个埋点 + 一条注释)无关:
它找 `.side-bar .opened-files > .title .icon-arrow`,而**今天上午的
`fcea56d9` 把「打开的文件」与「最近文件」并成了一个 `.file-list`**,
那个区块连同箭头一起没了。渲染层里 `.opened-files` 已一个都不剩,只活在这个用例里。

**没有删用例**:它保护的行为还在——折叠状态跨侧栏开关保持。重做后
`showFileList` 存在 localStorage(`SHOW_FILE_LIST_KEY`),tree 被 v-if 销毁重建也不丢,
正是 #2421 的修法。所以只把选择器指到 `.file-list`,谁把它改回普通 ref 它照样会红。

**这正是本文件早已写明的风险第一次兑现**:`e2e.yml` 每次推 PR 自动触发、约 13 分钟、
`cancel-in-progress`,连续推送时它永远跑不完。侧栏重做之后到现在,**它没有一次跑完过**,
所以这条断裂躺了好几轮才露头。**教训:改完渲染层要留出一轮不推送。**

修复本机验不了(无 Electron/Xvfb),已由 CI 复跑确认:`e6db7d31` 的 E2E
**229 过 / 0 失败**,比修复前的 228 过 + 1 失败正好多出这一条。

### 第四份日志(第 83 轮):埋点的名字骗了我

新包(`f0212a3d`)跑出的日志。这次整体慢约 1.3 倍(WebView2 1824 ms、script start +770 ms),
所以看比例。`mounted → editor mounting` 由 356 涨到 464 ms,四段拆分:

| 区间 | 耗时 | 占比 |
|---|---|---|
| mounted → **commands ready** | **397 ms** | **86%** |
| → bootstrap dispatched | 8 ms | 2% |
| → listeners registered | 3 ms | 1% |
| → editor mounting | 56 ms | 12% |

**先说被证伪的**:约 40 次 `LISTEN_*` 注册合计 **11 ms**。我原本相当怀疑它——
桥的 `registerEvent` 每次都要 `listen()` 发一趟 Tauri 事件订阅——**错了,不在这里。**
Vue 重渲染(含侧栏挂载)56 ms,也不是。

**再说 397 ms 不是什么**。本机 V8 上把嫌疑逐项定价(真实依赖,`node`):

| 项目 | 耗时 |
|---|---|
| `createI18n` | 4.8 ms |
| 118 个 `t()` 首次调用(含 vue-i18n 惰性编译) | 12.4 ms |
| 同样的键再来一次(热) | 2.9 ms |
| `SORT_COMMANDS` 的 `localeCompare` 排序 | 9.8 ms |
| 同样排序改用缓存的 `Intl.Collator` | **0.2 ms** |
| 83 条命令赋值进深响应式 `ref` | 0.5 ms |
| 通过响应式 Proxy 排序 | 11.8 ms |
| 同样排序在普通数组上 | 0.1 ms |

**全部加起来不到 40 ms,而实测 397 ms。** 冷 WebView2 慢 10 倍讲不通。

**真正的问题是我读错了埋点**。`getCommandsWithDescriptions()` 的函数体是纯同步的,
按 JS 语义它在 `await` 求值时就跑完了——**即在 `mounted` 埋点之前**。
所以叫 `commands ready` 的标记**从来没有度量过命令表**。
那个窗口里排的是 `mounted` 之后要清空的微任务队列,最大嫌疑是
`onMounted` 开头那句 `SET_USER_PREFERENCE(initialState)` 触发的**整个外壳重渲染**
(Vue 的调度器 flush 也是微任务)。

**这是本文件记过一次的同一种错**:上一轮把 `engine constructed` 改名成
`engine about to build`,正因为名字会把读日志的人引向反方向。这次名字又骗了我一轮。
**教训:埋点命名要说它在代码里的位置,不要说它"测的是什么",后者是待证的结论。**

已加两处埋点把窗口彻底切开:`microtasks drained`(我们的续体第一次拿到 CPU,
之前的都是排在前面的微任务)、`commands sorted`(赋值 + 排序,本机 12 ms)。
到 `commands ready` 的剩余才是那约 10 个监听注册。
**若 397 ms 落在 `mounted → microtasks drained`,那它属于偏好设置引发的重渲染,
和命令中心无关**,改法也完全不同。

顺带一个无论如何都成立的小结论:`SORT_COMMANDS` 用 `localeCompare` 且未缓存 Collator,
在普通数组上是 0.1 → 9.8 ms 的 100 倍差距。绝对值小,**没有据此改动**——
这条路径一共才 12 ms,改它属于拿不到的收益。记在这里是为了下次别重新发现一遍。

### 首屏字节第一次被逐字节归因(第 84 轮)

此前几轮削首屏(axios、图标集、emoji 表、设置窗组件)靠的是**逐个怀疑**。
这次拿到了地图:带 `--sourcemap` 重建,按 mapping 段把生成字节归还给来源。
脚本口径:每个 mapping 段拥有从它开始到下一段之间的生成列;归并到包名。

**入口 JS `index-*.js` = 1889 KB**(归因覆盖 1886 KB):

| 体积 | 占比 | 来源 |
|---|---|---|
| **285 KB** | **15.1%** | **katex** |
| 156 KB | 8.3% | element-plus(已裁到 15 个组件) |
| 85 KB | 4.5% | app: components |
| **78 KB** | **4.2%** | muya `utils/prism/loadLanguage.ts`(实为 `prismjs/components.js` 语言目录) |
| 71 KB | 3.8% | muya `muya.ts` |
| 46 KB | 2.4% | @vue/runtime-core |
| 46 KB | 2.4% | vue-i18n |
| 44 KB | 2.3% | prismjs |
| 41 KB | 2.2% | marked |

mermaid / katex(第二份) / sourceCode / preference / emojis / embed 均已是懒加载分块。

**两个最大项都动不了,原因相同——引擎内部同步使用**:
- katex 有三处**静态**导入(`inlineRenderer/renderer/inlineMath.ts`、
  `utils/marked/extensions/math.ts`、`block/extra/math/mathPreview.ts`),
  都同步调 `renderToString`。改惰性要引入「先占位、加载完再重渲染」,
  动的是 muya 的渲染语义,不是配置。
- prism 的 78 KB 语言目录被 `codeBlockContent/index.ts:170,423` 的
  `transformAliasToOrigin` **同步**读取(语法定义本身早已是动态 `import`)。
- 另注:`utils/prism/index.ts:81-82` 在**模块作用域**就 `loadLanguage('latex')`
  与 `('yaml')`,启动即触发两个动态 import。

`lodash.remove`(12.7 KB)是传递依赖,源码无直接引用;`fuse.js` 三处都在 muya 内部。

**更大的一项在 JS 之外:入口 CSS 507.9 KB,单文件、`<link>` 挂在 index.html 上,渲染阻塞。**
其中 **`.el-` 规则约 372.5 KB(73%)**,而本窗口只用 Element Plus 约 80 个组件里的 15 个。
`element-plus/theme-chalk/el-*.css` 的按组件样式表是现成的,组件清单本来就手工维护在
`main.ts` 里,同步 CSS 是同一处编辑。

**`main.ts` 里"CSS 不值得拆"的理由不完整**,原文说的是「CSS 没有 JS 那样的解析成本」——
但 CSS 的代价从来不是解析,是**阻塞首次绘制**。

**没有动手,理由要说清**:Element Plus 组件之间有内部样式依赖
(dialog→overlay、tree→checkbox、dropdown→popper/tooltip),漏一个就是视觉损坏;
**本机无 GUI,E2E 查的是 DOM 与对比度,查不出布局崩坏**。
在能目视验收之前盲改,正是本文件记过三次的那种错。
可行的安全路径是 `unplugin-element-plus`——它按实际用到的组件自动引入样式并处理依赖,
把"手工同步"这个风险源去掉;或先做静态覆盖检查(从产物里抽出所有 `el-*` 类名,
核对按组件样式表是否覆盖)。**留给能目视验收的那一轮。**

**量级要诚实**:这是本地应用,资源走自定义协议而非网络。按日志里 1902 KB 打包体
耗 125 ms 折算(约 15 KB/ms),508 KB CSS 约 33 ms 取用加解析应用。
削掉 372 KB 大约值 **30–60 ms**,对 3.6 s 的启动是个位数百分比。
**真正的大头仍是 WebView2 的 1.0–1.2 s,那是 Web 技术栈的地板。**

### 入口 CSS 砍掉一半(第 85 轮)

上一轮判定"需目视验收、不盲改",并提了两条可能的安全路径。这轮先试了其中一条,
**它自己否定了自己**:静态覆盖检查(从产物抽 `el-*` 类名核对按组件样式表)只抽到 45 个字面量,
`el-col`、`el-tab-pane`、`el-option` 等 17 个显示"无人声明"。原因是
**Element Plus 的类名多由 BEM 辅助函数在运行时拼接**(`ns.e('header')` → `el-dialog__header`),
根本不以完整字面量存在。**这条路在原理上就走不通,别再试。**

另一条成立:`element-plus/es/components/<name>/style/css` 是官方的按组件样式入口,
**它自己 import 依赖的样式**——`dialog/style/css` 带 base + overlay,`tree/style/css`
带 base + checkbox + text。于是依赖链是 Element Plus 的声明,不是我猜的内部实现。

改动:`main.ts` 的 `element-plus/dist/index.css` 换成编辑器窗 15 个组件的样式入口;
`prefComponents/settingsComponents.ts` 加上设置窗 10 个的。结果:

| | 改前 | 改后 |
|---|---|---|
| 入口 CSS(渲染阻塞) | 507.9 KB | **265.6 KB** |
| 其中 `.el-` 规则 | 372.5 KB | **132.7 KB** |
| 设置窗组件样式 | 在入口里 | 移到 `preference-*.css` 53.2 KB |
| 入口 JS | 1902 KiB | 1902 KiB(未变) |

**风险是怎么消掉的**:旧注释担心"按组件样式表要手工同步",这是真的。
但组件清单本来就手工维护,且 `element-plus-registration.spec.ts` 早已按两棵组件树里
真实出现的 `<el-…>` 标签把关。所以给该用例加了一条:
**样式导入必须与各窗注册的组件集合完全相等**。写的时候它立刻抓到我漏了 `El` 前缀,
说明它是活的。没有命令式 API(`ElMessage`/`ElMessageBox`/`ElNotification`/`ElLoading` 全仓为零),
那类最容易漏样式的用法不存在。

**丢了什么,已逐条查实(第 86 轮)**。类名虽由运行时拼接,但 **CSS 选择器是静态文本**,
可以精确枚举。全量样式表 809 个 `.el-*` 选择器,产物仍带 675 个,丢 134 个:

- 绝大多数属明确未使用的组件(alert / calendar / carousel / date-picker / drawer /
  upload / transfer / tour / steps / menu / message / notification / loading …)。
- 与在用组件同前缀的逐条看过,全是**别的组件**:`el-table-v2`、`el-tree-select`、
  `el-checkbox-group` / `el-checkbox-button`、`el-radio-button`、`el-overlay-message-box`、
  `el-pagination` / `el-pager`、`el-sub-menu`、`el-picker*` / `el-range*` / `el-month-table`。
- 三个不以标签形式出现、可能被直接写进 `class` 的也查了:`el-transitioning` 来自
  `el-carousel.css`,`el-vg` 来自 `el-virtual-list.css`(select-v2/table-v2 用),
  `el-icon-arrow-right` / `el-icon-circle-close` 是旧图标字体类
  (本项目用 `@element-plus/icons-vue` 的 SVG 组件)。**应用源码里没有任何一处直接写这些类名。**

**深色模式无回归**:Element Plus 的 `theme-chalk/dark/css-vars.css` 是独立文件(2.9 KB),
全量表里本就只有 3 条 `.dark` 规则,而本仓从未引入过它——深色走的是自己的 `addThemeStyle`。

**CI 也过了**:`510d6e8b` 的 E2E 在**真实 Electron** 上全绿(侧栏树、对话框、下拉、标签页,
含深色模式对比度用例)。

**仍未验证的只剩"好不好看"**:E2E 查 DOM 与对比度,查不出布局塌陷。
**这一条要由跑安装包的人目视确认。**

**一个未了结的间歇性失败**:全量单测带改动跑 5 次,`pdf.spec.ts` 失败过 1 次
(`window.marktext` 在 `beforeEach` 明明赋过值却是 undefined);干净树跑 3 次全过。
样本不足以区分,且 `@/util/pdf` 的模块图里没有本次改动的任何文件(它只引 muya core、
内联 CSS、dompurify)。失败形态指向该 spec 自己「首个用例 delete 全局、靠 beforeEach 兜底」
的写法。**没复现、没归因,记在这里,盯 CI。**

### 大文件:又一个二次项,和 math 那个一模一样(第 87 轮)

先确认首屏 JS 已到地板:按文件归因应用代码,最大单文件 `store/editor.ts` 25.9 KB,
把几个对话框改懒加载总共约省 20 KB(1%),**不值当**。构建目标已是 `esnext`,没有余量。
剩下的都是库,而最大两项(katex 285 KB、prism 目录 78 KB)要动引擎的同步语义。
**削首屏这条线到此为止。**

转到"支持大文件"。对 296 KB 文档做 CPU profile,自身耗时里冒出两个新面孔:

| 占比 | 函数 |
|---|---|
| 29.1% | `addRange`(**已排除的假线索**,去掉它到首帧无差别) |
| 8.9% | `patch`(inlineRenderer,预期之内) |
| **7.1%** | **`utils/marked/extensions/footnote.ts` 的 `start`** |
| 4.5% | `event/index.ts` 的 `_checkHasBind` |

**而这份测试文档里一个脚注都没有。**

原因本文件已经记过一次——`math.ts` 的注释写着:marked 会在**每个 token 边界**对
**剩余全文**调用每个扩展的 `start()`,所以一条不可能匹配的规则仍要付一次扫描;
能证明它不可能匹配的调用方应当关掉它。`lexBlock` 为 math 做了这个判断
(`src.includes('$')`),**却没给脚注做**。块边界数与文档大小成正比 × 每次扫剩余全文
= 二次方。

修法完全照搬先例:块规则与其 `start()` 都必须要有字面量 `[^`,所以
`footnote && src.includes('[^')`。实测(同机同会话,各取 3 次最好成绩):

| 文档 | 改前 perKB | 改后 perKB | 开文档耗时 |
|---|---|---|---|
| 147 KB | 7.85 ms | 7.85 ms | 持平 |
| 296 KB | 8.18 ms | 6.88 ms | 2421 → 2035 ms(−16%) |
| 593 KB | **10.20 ms** | **7.66 ms** | 6043 → **4543 ms(−25%)** |

**改前 perKB 随尺寸上升,改后是平的**——这是二次项被摘掉的标准形态,文档越大省得越多。

`src/state/__tests__/footnoteRuleGating.spec.ts` 钉住守卫(仿 `mathRuleGating.spec.ts`):
开头即定义、文档中部定义、front matter 之后定义、只有引用没有定义、完全无 `[^`。
**验过它有牙齿**:把守卫改成恒假,5 条里红 3 条。这一步是必要的——守卫写错的后果是
脚注**静默**不再解析,而不是报错。

**剩下的两个**:`addRange` 29% 已排除;`_checkHasBind` 4.5%(`event/index.ts:112`)未查。

### 第二个二次项:每次绑事件都全表扫描(第 88 轮)

上一轮 profile 里剩下的 `_checkHasBind`(`event/index.ts`,4.5–5.1%)查实了。
`attachDOMEvent` 在绑定前会**线性扫描整张 `events` 表**确认没绑过。
关键问题是这张表会不会随文档增长——量了,**会**:

| 文档 | 块数 | 事件数 | 每块 |
|---|---|---|---|
| 250 节 | 500 | 600 | 1.20 |
| 1000 节 | 2000 | 2100 | 1.05 |
| 4000 节 | 8000 | 8100 | 1.01 |

约每块一条,而绑定次数也与块数成正比 → **N 次绑定 × 扫描长度 N/2**。
8000 块约 3300 万次比较,16000 块约 1.3 亿次。

改法:加一个只用于「是否已绑过」的索引 `WeakMap<target, IEvent[]>`。
`events` 数组保持原样(它是真相来源,且 `listener-leak.spec.ts` 在数它的长度)。
**按 target 挂一个短数组、而不是再按事件名建 Map**——一个元素上没几个监听,
短数组扫得起,而每 target 一个 Map 的内存比省下的还多(实测每块 +150 B vs +55 B)。
扫描也保住了原有的 `===` 语义(`capture` 可能是 options 对象,身份比较不能替换成字符串键)。

**证据(计时噪声太大,靠低噪声的直接证据)**:
- profile 里 `_checkHasBind` **从 5.1% 降到不再出现**,总采样 10523 → 9165(−13%)。
- 开文档耗时 147/296/593 KB 各降 16%/7%/9%,**但跑次间波动 ±20%,
  不足以从计时读出二次方形态**——这一点必须说清,不能拿单次数字当结论。
- 内存代价:每块 1019 → **1075 B**(+5%)。这是索引的开销,如实记下。

**正确性风险是我引入的**:索引会失效而扫描不会,失效的表现是**静默**——
重绑返回成功但监听器不响应。`src/event/__tests__/attachDomEvent.spec.ts` 六条钉住两个方向:
重复仍被拒;解绑后重绑、全部解绑后重绑、换事件名、换 target、换 capture 都仍能绑上。
**验过有牙齿**:把索引同步那段删掉,恰好「解绑后重绑」一条变红。

### 本机跑 muya 全量 e2e 不可信(第 88 轮)

带改动全量跑 **6 条失败**,干净树全量跑 **8 条失败**,两组几乎不重叠
(mermaid / undo-redo / markdown-to-html / public-api / blockquote vs
code-block-language-selector / footnote / unwrap-undo),
且**全部单独跑都通过**。这是本机满并发起多个 Chromium 的负载不稳定。

**结论:本机只单独跑相关 spec,全量 e2e 以 CI 的 Muya E2E 为准。** 不要再为此重复排查。

### 不再等日志:让 CI 读启动埋点(第 89 轮)

那 464 ms 已经等了三轮用户回传日志。其实不必等——**埋点在 Electron 下同样会写
`window.__MT_STARTUP__`**(只有写文件那句 `invoke` 是 Tauri 专属),
而我要归因的 `mounted → microtasks drained → commands sorted → commands ready`
**三段是纯渲染层代码,两个 shell 完全一致**。CI 的桌面 E2E 跑的就是真实应用。

新增 `test/e2e/startup-phases.spec.ts`:启动、等 `__MT_STARTUP__`、解析、**把各段打进日志**。
**断言的是仪器本身还好用**——每个阶段出现且仅出现一次、顺序与代码标记顺序一致、时间不倒流。
**不断言时长**:共享 runner 上 40 ms 级的阈值必然飘,飘了就会被静音,
最后变成没人看的仪器。数字打出来给人读。

顺序检查不是凑数:这些埋点**已经误导过两次**——`engine constructed` 标在建引擎之前,
`commands ready` 标在它没度量的工作下游。少一个或挪一个都是静默的,顺序检查挡的是这个。

**两个 shell 的差异要记住**:Electron 下 `bootstrap dispatched` 之后才等主进程的
`mt::bootstrap-editor`,所以 `editor mounting` 那一段两边不可比;
但它在被比较的三段之后,不影响归因。

### 渲染路径的下一步是架构级(第 89 轮)

profile 里 `snabbdom-to-html` 出现在热路径上,查实了原因:
`inlineRenderer.patch()` 的做法是 **vnode → HTML 字符串 → `domNode.innerHTML`**,
即每个内容块都要序列化成字符串、再由浏览器解析回 DOM,绕了一趟。
改用 snabbdom 的 DOM patch 可省掉这趟往返,对**打字延迟**收益更大(增量 diff 而非整块替换)。

**但这是渲染核心的重写**,牵动每种块类型、光标处理与一致性套件。
与虚拟化(只渲染可视区块)并列为架构级项,**不在迭代里做**。

### 第五份日志 + CI 对照:窗口切开了,而且指向两段离群(第 90 轮)

用户第五份日志(Tauri/Windows,含新埋点)与 CI 的桌面 E2E(Electron)同段对照:

| 区间 | Electron(CI) | Tauri(Windows) | 倍数 |
|---|---|---|---|
| script start | 416 ms | 861 ms | 2.1× |
| **mounted → microtasks drained** | **41 ms** | **393 ms** | **9.6×** |
| commands sorted(赋值+排序) | 10 ms | 29 ms | 2.9× |
| commands ready(约 10 个监听) | 0 ms | 51 ms | — |
| editor mounting(Vue 重渲染) | 94 ms | 65 ms | 0.7× |
| **editor ready(建引擎+渲染)** | **68 ms** | **601 ms** | **8.8×** |

**第 83 轮的结论坐实**:那段从来不是命令表——赋值加排序只有 29 ms
(与本地基准的 12 ms 同量级),监听注册 4 ms。**393 ms 全在 `mounted` 之后的微任务清空里。**

**新信息是"离群"**:整体 Tauri 比该 CI runner 慢 2–3 倍属机器差异,
但有两段慢了近 10 倍,**远超基线**——这两段里有 Tauri 特有的成本。

**一个被证伪的假设**:我原以为是 `SET_USER_PREFERENCE(initialState)` 触发的大规模重渲染。
查实:`initialState` 在**两个 shell 下都走 `parseUrlArgs()` 的 URL 参数**,只有 5 个字段,
是同一条代码路径做同一件小事。**不是它。**

**本机无法继续**:这两段的成本是 Tauri 特有的,而 CI 只能给 Electron 的数字。
所以加两处埋点各问一个问题:
- `shell flushed`(app.vue,`nextTick`):Vue 把 `SET_USER_PREFERENCE` 的改动 flush 完的时刻。
  落在 393 ms 末尾就是重渲染,落在开头就是别的东西排在前面。
- `engine constructed`(editor.vue,`new Muya` 之后、`init()` 之前):
  把 601 ms 拆成"构造"与"建文档+渲染"。harness 量过构造约 7 ms + 文档,
  所以构造若明显超过它,与"文档大所以画得慢"是两个问题。

**`shell flushed` 不进顺序断言**:它由 `nextTick` 触发,落点取决于当时有没有待处理的 flush
——而那正是它要测的东西。写死顺序就是一条会飘的断言,只断言它出现且仅出现一次。

### `addRange` 在 4 倍尺寸上复核:还是假线索(第 91 轮)

第 82 轮把 `addRange`(profile 自身耗时 29–33%,全场最大)判为假线索,
依据是「到首帧无差别」。但那次只测到 **2400 块**,而两个二次方修完后
我们关心的是 **8000–16000 块**——**结论的适用范围值得复核,否则就是拿小尺寸的结论管大尺寸**。

同样的实验(把 `Selection.prototype.addRange` / `extend` 打桩成空操作,量到首帧的双 rAF),
放到 12000 块:

| | min | median |
|---|---|---|
| 带光标定位 | 3309 ms | 3699 ms |
| 去掉光标定位 | 3344 ms | **3838 ms** |

**没有差别,去掉反而略慢。原结论在 4 倍尺寸上成立。**

**方法上的教训**:第一次用 3 次取样、看**最好成绩**,得到"去掉快 10%"的暗示;
加到 7 次交错取样后看中位数,暗示消失。原始样本里有 **20459 ms 和 9566 ms** 两个 GC 停顿离群值,
`min` 恰好被它们带偏。**大文档的重建测量必须交错取样、看中位数,不能用 best-of-3。**

顺带一个 harness 事实:连续 6 次重建 8000 节文档而不强制 GC,**标签页会被杀掉**。
测量循环里要在两次重建之间 `HeapProfiler.collectGarbage`。

**至此 profile 里最大的一项关账**:`addRange` 那 33% 不可回收(它是一次强制同步布局,
到首帧的总量不变)。剩下的 `patch` 9.2% / `setAttribute` 6.3% / snabbdom-to-html 约 5%
都在渲染路径上,而那条路要动就是架构级(见上一节)。

### 订正:`editor ready` 的 8.8× 可能根本不是 Tauri 慢(第 92 轮)

上一轮我把两段列为"离群"(近 10 倍,远超 2–3 倍的机器基线),其中一段是
`editor ready`(Electron 68 ms vs Tauri 601 ms)。**这个比较不成立。**

CI 的 E2E 打开的是 `# Doc\n\nSome text.`,用户打开的是真实文档。
而 muya harness 早就量过这一段几乎完全是文档大小的函数:
4.4 KB → 52 ms、90 KB → 712 ms。**601 ms 完全可能只是"文档大"**,
我拿小文档的 Electron 去比大文档的 Tauri,量的是两件不同的事。

`mounted → microtasks drained` 那 393 ms 不受此影响——文档内容要到
`bootstrap dispatched` 之后才进来,不在那个窗口里。**那一段的离群仍然成立。**

**治本**:`engine about to build` 现在带上文档大小(`engine about to build (NN KB)`),
与 `bundle fetched (1902 KB)` 同格式。**没有大小的日志,这一段两份之间根本不可比**,
而"照比不误"正是上面这个错误的来源。

E2E 用例相应改为**按去掉括号后的名字匹配**,打印时仍用原始名字(否则新信息在 CI 日志里看不见)。
顺带一个发现:**Electron 下没有 `bundle fetched`**(JS 的 resource timing 没被记录),
所以它不能进必选阶段列表——差点就这么加进去了。

### 打字延迟随文档大小线性增长(第 93 轮)

开文档已经线性了,但**编辑**这一半从没量过。量了:

| 文档 | 每次击键 |
|---|---|
| 500 节(1000 块) | 17.1 ms |
| 4000 节(8000 块) | **121.8 ms** |

8 倍文档 → 7.1 倍延迟。**一次击键本该是 O(1),不该是 O(文档)。**

带调用链的 profile 找出两条 O(文档) 的路径:
- `deepClone` ← `getState` ← **`dispatch()`**(`prevDoc`,给撤销算逆操作用)
- `offset`/`iterator` ← `parent.offset` ← `get path` ← `getSelection` ← `eventHandler`
  (`LinkedList.offset` 的实现是 `[...this.iterator()].indexOf(node)`——**每次把整条链表铺成数组**)

**但先定价再动手,这次救了我一回。** `_record` 只把 `prevDoc` 用于
`invertWithDoc` 之后就丢掉,所以"在 apply 前用活状态算好逆操作、只发逆操作"是可行的,
把 O(文档) 变成 O(op)——我正要去动撤销/重做的契约。
**先量了那次拷贝**:4000 节文档 `getState()` 只要 **6.8 ms**,而一次击键 127.9 ms。
**拷贝只占约 5%。为 5% 去动 undo 的契约,不值。**

那 O(文档) 的大头在 `(program)`(80%,浏览器内部样式/布局),不是 JS。

**已做的**:`_collectReferenceDefinitions` 改读活状态(新增 `JSONState.readState()`,
契约是"只读,不得改")。它每个文档版本跑一次——即每次击键一次——原本要 `getState()`
克隆整份文档。**按上面的定价这值约 6.8 ms/击键(约 5%)**;端到端计时的噪声大于这个量,
所以**不拿端到端数字当证据**,依据是那次拷贝的独立定价。

**试过并否决**:给顶层块加 `content-visibility: auto`(让浏览器跳过屏幕外的块)。
4000 节文档打字 125.8 → 118.7 ms/击键,约 6%,在噪声内。**不值得为此改变滚动/查找的行为。**

### 第六份日志:一个真问题,和一个"不是我们"(第 93 轮)

**用户问"怎么越来越慢"。把日志两半分开看**:

| | 第一行 JS 之前 | 渲染层(导航→可用) |
|---|---|---|
| 日志 3 | 1018 ms | 1378 ms |
| 日志 4 | 1227 ms | 1905 ms |
| 日志 5 | 2386 ms | 2134 ms |
| 日志 6 | **2830 ms** | 2158 ms |

**渲染层在最近两次之间几乎没变,JS 之前那段翻了近三倍。** 那段是进程拉起 + 插件初始化 +
窗口创建 + WebView2,`plugins ready` 只占 130 ms。**一个待验证的解释**:每次都是新的
**未签名二进制**,Windows Defender / SmartScreen 首次运行会扫描它——
**同一个包连跑两次**即可把首次代价分离出来。

**`shell flushed` 的答案是否定的**:它落在 +1333,**晚于** `microtasks drained`(+1285)。
**那 343 ms 不是 Vue 重渲染**,flush 在我们的续体恢复之后才完成。假设被证伪,该段仍未归因。

**真问题**:`engine about to build (8 KB)` → `engine constructed` 32 ms →
`editor ready` **697 ms**。harness 的价目是 4.4 KB → 52 ms、90 KB → 712 ms。
**8 KB 的文档花了 90 KB 的钱,差约 7 倍。** 构造本身只有 32 ms,问题在 `init()` + 渲染。

**这同时推翻了第 92 轮我自己的"订正"**——我当时猜 601 ms 是因为用户文档大,
把大小写进埋点正是为了查证,结果证明**不是**。最可能的解释是文档**内容**而非大小:
代码块要动态加载 prism 语法、公式要 katex、mermaid/vega 图表更重,
而 harness 用的是纯散文加标题。**下一轮从这里查。**

### 代码块每 KB 比散文贵 7.6 倍,原因是布局抖动(第 94 轮)

上一轮留下的问题:用户的 **8 KB 文档花了 697 ms**,而 harness 的价目是 4.4 KB → 52 ms。
假设是"内容类型"而非大小。**固定大小、只变内容**,一测就清楚(各约 60–68 KB,3 次取中位数):

| 内容 | 每 KB(改前) | 相对散文 |
|---|---|---|
| 散文 | 5.80 ms | 1× |
| 行内代码 | 6.37 ms | 1.1× |
| **代码块** | **44.22 ms** | **7.6×** |
| 代码块(无语言标注) | 37.31 ms | 6.4× |
| 公式 | 23.46 ms | 4.0× |
| 表格 | 11.98 ms | 2.1× |
| 列表 | 10.51 ms | 1.8× |

**假设成立。** 而且无语言标注仍有 6.4×,说明大头**不是 prism 高亮**。
**harness 那张价目表是用纯散文量的,不能拿来描述真实文档**——这是它第二次误导判断
(第 92 轮我据它猜"用户文档大",错了)。

带调用链的 profile 直接指名:**45.1% 在 `getBoundingClientRect`,来自
`utils/codeBlockLineNumbers.ts` 的 `repositionLineNumberSpans`**。
它逐行 `range.getBoundingClientRect()` 读位置,**又在同一个循环里写 `span.style.top`**
——写让布局失效,下一次读就强制重算,而强制的是**整篇文档**的布局。经典的布局抖动。

**改法**:先全部读、再全部写。N 次强制布局变 1 次。

| 内容 | 改前 | 改后 |
|---|---|---|
| 代码块 | 44.22 ms/KB | **34.22**(−23%) |
| 代码块(无语言) | 37.31 ms/KB | **24.38**(−35%) |

68 KB 代码密集文档:开文档 3007 → **2327 ms**。散文/表格/公式在噪声内(未受影响)。

**测试**:`codeBlockLineNumbers.spec.ts` 新增一条钉住**读写分离**本身。
**这条必须有**——把两趟合回一趟输出完全相同,现有 15 条断言一条都不会红,
性能却悄悄退回去。它监听 `getBoundingClientRect` 与 `style.top` setter 的调用顺序。
**验过有牙齿**:交错回去,恰好这一条变红。e2e 侧 `code-font.spec.ts` 的三条
"改字号要重新测量行号槽"也通过,行号仍对齐。

**剩下的**:公式 4×(katex 渲染)、表格 2.1×、列表 1.8× 尚未查。

### 同一个坑往上一层:每块一次仍是二次方(第 95 轮)

上一轮把「每行一次强制布局」降成「每块一次」。**但每块一次仍是 N 次全文档布局。**
先测曲线,别假设已经解决:

| 块数 | 改前 perKB | 批处理后 perKB |
|---|---|---|
| 220 | 16.55 ms | 12.42 ms |
| 440 | 17.72 ms | 10.58 ms |
| 880 | **23.61 ms** | **9.90 ms** |

**改前随尺寸上翘(二次项还在),批处理后变平甚至略降。**

改法:`scheduleLineNumberReposition` 把所有块的重定位合并进**一帧**,
帧内先测量全部、再写入全部 → 整批只付一次布局。
`repositionLineNumberSpans` 保留为同步版本(测试与直接调用方在用)。

**两轮合计**:68 KB 代码密集文档 **3007 → 675 ms(4.5×)**;
代码块相对散文由 **7.6× 降到约 1.8×**。

**代价与验证**:重定位改为下一帧执行,这是行为变化。
`code-font.spec.ts` 的三条"改字号要重新测量行号槽"仍通过(Playwright 会重试断言),
`typing/code-block.spec.ts` 与 `tests/blocks` 共 44 条全过。
新增两条单测:跨块批处理的读写顺序、以及**取消**(块在帧到来前被移除就不该再被测量)。
**验过有牙齿**:把跨块批处理拆回逐块,恰好那一条变红。

### 内容类型这条线关账(第 96 轮)

连着两轮从"读写交错强制布局"里挖到大收益,所以先做同类排查:
`getBoundingClientRect` / `offsetTop` / `getComputedStyle` 在 muya 里的其余调用点,
**都在交互路径**(拖放、粘贴、图片工具、点击空白区),**没有一处在逐块渲染路径上**。
代码块是唯一的一处,已修完。

再把剩下三种内容各测三档,看有没有藏着的二次项:

| 内容 | perKB(小 → 大) | 形态 |
|---|---|---|
| 公式 | 25.24 → 24.35 → 22.03 | 平/略降 |
| 表格 | 14.88 → 12.54 → 10.85 | 略降 |
| 列表 | 11.64 → 10.16 → 10.03 | 平 |

**三者都线性,没有 bug**。公式的 profile 里最大的是已排除的 `addRange`(29.5%),
katex 的渲染甚至没进前六——**公式贵是"公式本来就贵"**。

顺带看到一处结构性浪费(归入已记的架构级项,未动):`inlineMath` 是
katex 产出 HTML → `htmlToVNode` 转 vnode(5.3%)→ `patch` 再序列化回 HTML 字符串
→ `innerHTML`。同一份内容来回转了两趟。

**结论:大文件路径上能靠局部修复拿到的收益已经取完。** 只有代码块藏着二次方,
其余内容类型的成本是各自的固有成本。再往下是架构级(vnode 直接 patch DOM、虚拟化)。

### "占用低"第一次有了运行时证据(第 97 轮)

查证发现:这条要求**从未被真正测量过**。`getAppMetrics` / `memoryUsage` /
`workingSetSize` 在全仓零命中。此前的依据是**安装包体积**(6.4 MB vs 284 MB)
和**引擎的 JS 堆**(空白 8.6 MB、每块约 1 KB)——但**两者都不是用户在任务管理器里看到的东西**:
安装包不描述运行时,JS 堆只是若干进程之一里的一个数字。

新增 `test/e2e/footprint.spec.ts`:CI 里真实 Electron 跑起来后,
用 `app.getAppMetrics()` 报告**每个进程**的工作集(browser / renderer / GPU / utility),
外加渲染进程的 JS 堆。**数字本身是产物**,断言只防"读数失去意义"
(没有进程、有进程报 0、总量失控),**不设紧阈值**——共享 runner 上会飘,飘了就会被静音。

**一处刻意的克制**:没有按名字断言渲染进程是 `'Tab'`。那是 Electron 的内部命名、
跨版本变过,而本机跑不了 Electron 验不了。**因为一个标签名而失败的用例比没有用例更糟**,
改为断言"有 Browser,且至少还有一个别的进程"。

**用途**:这给 Tauri 版一个可对标的基线——用户在任务管理器里读到的数,
与这份 Electron 数字对比才有意义。

**首批数字(CI Linux runner,小文档,`2124156e`)**:

| 进程 | 工作集 |
|---|---|
| Browser(主进程) | 208 MB |
| Tab(渲染进程) | 173 MB |
| GPU | 139 MB |
| Utility | 87 MB |
| **合计** | **608 MB** |
| 渲染进程 JS 堆 | 15 MB |

同一次运行的旁证:编辑器可用 993 ms、139 KB 文档 200 节渲染 2102 ms、
五次击键 227 ms、堆 10.2 → 14.6 MB(持有文档)。

**对比时必须避开的陷阱**:Tauri 用系统 WebView2,而 **WebView2 自己也会起独立进程**
(msedgewebview2.exe 的浏览器/GPU/渲染进程)。
**拿 Tauri 主 exe 的内存去比 Electron 的 608 MB 合计,会得到一个偏袒 Tauri 的假结论。**
诚实的口径是:两边都统计**该应用引起的全部进程**。
在任务管理器里,要把 marktext 之下的 `msedgewebview2.exe` 一并计入。

**另一处口径差异**:这份数字来自 CI 的 Linux runner,用户的是 Windows。
跨平台的绝对值不可直接相减,**可比的是"同一台机器上 Electron 版 vs Tauri 版"**。

### 订正:上一轮那个"否定结论"是我读错了探针(第 98 轮)

第 93 轮我写道:`shell flushed` 落在 `microtasks drained` 之后,
**所以那 343 ms 不是 Vue 重渲染**。**这个推理是错的,该结论作废。**

按微任务队列的语义:`SET_USER_PREFERENCE` 触发的 flush 任务在挂载期间入队;
命令存储 `await` 的续体在其**之后**入队;而 `nextTick` 的回调要等 flush 的 promise
兑现后才入队,**必然排在续体之后**。
所以 `shell flushed` 落在 `microtasks drained` 之后**是队列语义决定的,不含任何信息**——
而 flush 本身**一定跑在 `microtasks drained` 之前**,因此它仍然完全可能就是那 343 ms。

**教训**:探针的位置决定了它能回答什么。这个探针从一开始就答不了这个问题,
而我把"它没落在我预期的位置"当成了否定证据。**在读探针之前,先想清楚它在事件顺序里的位置。**
(这是同类错误的第三次:`engine constructed` 名字指反方向、`commands ready` 站在无关工作下游、
现在是 `shell flushed` 的排队位置。)

**换成能答的探针**:`app.vue` 加 `onUpdated`(只记第一次)→ `shell updated`。
它**在 flush 内部**运行:靠近 `microtasks drained` 就说明重渲染就是那 393 ms,
靠近 `mounted` 就说明另有其人。

E2E 用例把它列为**可选**而非必选:`onUpdated` 只在真有重渲染时才触发,
**而"有没有重渲染"正是它要回答的问题——要求它必须出现等于把答案写进断言**。
只断言它不会出现两次。

### 打字的浏览器侧拆开了(第 99 轮)

打字随文档线性(1000 块 17 ms/击键 → 8000 块 122 ms),其中 80% 落在 JS profiler
不归因的 `(program)`。用 CDP 的 `Performance.getMetrics` 把它拆开:

| 文档 | wall | 布局 | 样式重算 | 脚本 | 其余(TaskOther) |
|---|---|---|---|---|---|
| 500 节 | 333 ms | 29 ms | **1 ms** | 89 ms | ~200 ms |
| 4000 节 | 2097 ms | 267 ms | **0 ms** | 422 ms | **1436 ms** |

- **样式重算约等于零 → 选择器问题排除**(本来是最值得修的一类,先排除它)。
- **布局**每次击键恰好一次(`layoutCount=20`/20 键),随文档线性,但只占击键的 13%。
- **脚本** 20%。
- **其余 68%** 是浏览器内部(绘制/HTML 解析/合成),**同样随文档增长**。

`patch()` 每次把块序列化成 HTML 交给 `innerHTML`,浏览器要重新解析——
这与已记的架构级项(vnode 直接 patch DOM)对得上。**没有局部修法。**

**一个必须写下的口径警告**:这些数字全部测自 Playwright/CDP 驱动的浏览器。
自动化会开启一些真实运行时未必开启的内部机制(如可访问性树维护),
**"其余" 那一项可能被自动化本身抬高**。这不影响"随文档线性"的结论(两档同样条件),
但**绝对值不应被当成用户实际体验的打字延迟**。

### `shell updated` 在 Electron 下的落点(第 99 轮)

CI 首份数据:`mounted` 237 → `microtasks drained` 261(**仅 24 ms**),
而 `shell updated` 落在 **313 ms**——在 `listeners registered`(269)**之后**。

**说明 Electron 下 `SET_USER_PREFERENCE` 根本没触发重渲染**
(那 5 个 URL 参数字段要么与默认值相同、要么没有渲染方),
第一次更新来自 `bootstrapEditor` 置 `init`。

**所以这个探针是能分辨的**:Tauri 侧若 `shell updated` 落在 393 ms 窗口**之内**,
重渲染就是元凶;若同样落在 `listeners registered` 之后,那 393 ms 另有其人。
**等用户的下一份日志。**

### 给本会话最大的那个修复配一条守效果的用例(第 100 轮)

代码块那两个修复(3007 → 675 ms)此前**只有读写顺序和批处理顺序的单测在守**。
**那守的是实现方式,不是效果**——二次方若以别的形式回来
(比如有人在别处新增一次逐块的布局读取),顺序断言一条都不会红。

新增 `e2e/tests/stability/code-block-linearity.spec.ts`,与 `heap-linearity` 同构:
220 与 880 块两档,断言**每 KB 成本不随文档上翘**(容差 1.35×)。
**断言的是斜率而不是时长**,所以慢机器会把两个测量一起抬高,不会误报。

实测 12.45 → 9.33 ms/KB(平/略降),用时 7.4 s。
**验过有牙齿**:把跨块批处理退回逐块立即执行,变成 14.67 → 22.63 ms/KB(1.54×),用例变红。

### 国际化:键集齐整 ≠ 界面没有英文(第 106 轮)

`locale-parity.spec.ts` 验证的是 **10 种语言的键集完全一致**——
但**一个从未进过语言文件的字符串,在十种语言里同样"一致"**,而且十种语言都显示英文。
这条要求此前只有前一半的证据。

扫了所有模板:
- **标签之间的文本**干净。12 处字面量全是文件扩展名、产品名、picgo/包管理器命令,都不该翻译。
- **属性值**里找到一个真的:`sideBar/tree.vue` 的 `placeholder="Enter .md file name"`
  ——侧栏新建文件输入框,**中文界面直接显示英文**。
  上游 `../marktext` 同一行也是硬编码,所以是继承来的缺陷,不是迁移回归。

已修:新增 `sideBar.tree.newFilePlaceholder`,10 种语言各给译文,模板改绑 `t()`。
另一处 `import/index.vue` 的 `alt="import file"` 改为**空 alt**——
图标正上方就是 `t('import.title')` 与 `t('import.description')`,它是装饰性的;
**正确做法是不给替代文本,而不是给一个翻译过的**。

新增 `no-untranslated-strings.spec.ts` 守住这一类:
模板里静态的 `placeholder` / `title` / `alt` / `aria-label` 不得含成句字母
(绑定形式 `:placeholder="t(...)"` 与空 `alt=""` 都放行)。
**验过有牙齿**:把 placeholder 改回硬编码,它立刻变红。

### 通知里全是英文(第 107 轮)

同一把尺子量脚本侧,又抓到 **13 处**硬编码英文通知——**出错那一刻弹给用户的字**,
而那正是最不该显示看不懂的语言的时刻:

- `store/project.ts` 6 处:侧栏删除失败、粘贴被拒、粘贴失败、同名冲突。**最可能撞见的。**
- `commands/spellcheckerLanguage.ts` 2 处、`editor.vue` 1 处(图片上传)、
  `store/autoUpdates.ts` 4 处(Tauri 下 `isUpdatable:false` 触发不到,但 Electron 版会)。

上游 `../marktext` 同样硬编码,没有现成译文可复用,**14 个键 × 10 种语言全部自写**。

**一处设计选择**:原文是 `A ${type} named "${name}" already exists`,`type` 取
`'file'` / `'directory'`。直接注入会让译句里夹一个英文名词,**而且各语言的性/数配合不同**,
所以拆成 `fileAlreadyExistsMessage` / `directoryAlreadyExistsMessage` 两个独立成句的键。

守卫扩到通知(同一个 spec,已改名为 `no-untranslated-strings`),**同样验过有牙齿**。

### Rust 菜单的翻译键:现状干净,但此前无人守(第 108 轮)

原生菜单是最显眼的界面文字,而它走的是**另一套机制**:Rust 侧 `menu/i18n.rs` 直接读语言文件。
扫了 `src-tauri`:**菜单标签全部走翻译键,没有一处硬编码**。
引用的 101 个键在 `en.json` 里也全部存在(初扫报缺 5 个,查证后全是 `i18n.rs` 里
Rust 单测**故意用不存在的键**做断言,已排除)。

**但这两侧之间此前没有任何东西连着**:菜单在 Rust 里按键取标签,键在 JSON 里;
拼错一个字、或先加菜单项后加键,菜单上就会直接显示 `menu.file.newTab` 这样的原始键名——
**而 Rust 测试和语言测试都不会红**,因为各自内部都是自洽的。
`locale-parity` 管的是"十种语言键集一致",不管"有人要的键是否存在"。

新增 `rust-menu-locale-keys.spec.ts` 补上这条跨包不变式。
两点设计:排除 `#[cfg(test)]` 之后的内容(Rust 单测有意用缺失的键);
并断言**至少找到 50 处查表调用**——否则正则哪天不匹配了,用例会在什么都没检查的情况下静默通过。
**验过有牙齿**:把 `menu.file.newTab` 改成 `newTabb`,它精确报出那一条。

**第 112 轮扩到渲染层**:自绘菜单栏(Windows/Linux 上真正显示的那个)全部用
`labelKey`/`titleKey`,**没有硬编码**;渲染层 **516 个字面量翻译键全部能解析**。
现状干净,但同样无人守——键写错只会在界面上显示原始键名,不会抛错。
守卫已合并改名为 `translation-keys-exist.spec.ts`,一个用例管住两侧
(Rust 的 `.t("…")`、渲染层的 `t('…')` 与菜单栏的 `labelKey`)。
**只检查字面量键**:运行时拼出来的 `t(\`x.${y}\`)` 从源码无法解析,
硬要检查只会带来误报或一条没人能遵守的规则。
两侧各自断言**最少命中数**(50 / 300),防止正则失效后用例在什么都没查的情况下静默通过。

### 文件选择器的过滤器标签(第 109 轮)

系统文件选择器里的过滤器名既不在模板也不在组件里,最容易漏。查到 2 处真的:
`files.ts` 的 `Images`(图片选择)、`import.ts` 的 `Documents`(pandoc 导入)。

**没有一并"修"的两处**:`Markdown` 是格式名(同 PNG),`MarkText` 是产品名,**译了才是错**。
守卫因此带一份格式名豁免表。

**这不是迁移引入的**:本仓 Electron 主进程与上游 `../marktext` 同样硬编码
(`All Files`、`Markdown document`)。**但主进程没有 i18n 基础设施**,
在那边修等于先搭一套框架,所以只修 Tauri 侧——Tauri 版比上游好,不违反"一个不少"。

守卫扩到过滤器(同一个 spec),**验过有牙齿**。

### 日期格式:一个方向相反的同类 bug(第 110 轮)

前几轮找的都是"该译没译的英文"。这轮在日期格式里找到**反过来的一个**:
`prefComponents/image/.../uploader` 的检测时间写死 `toLocaleString('zh-CN')`,
**于是除中文外的每种语言都会看到中文的日期习惯**。
改为跟随应用当前语言——本仓的 10 个 locale 代码本身就是合法的 BCP-47 标签,直接可用。

**没有一并改的一处**:同文件的诊断输出 `Detection time: ${new Date().toLocaleString()}`
不传语言参数、跟随操作系统,标签也是英文。**诊断文本保持英文是合理约定**
(用户复制去求助时更通用),守卫也因此只针对"传了写死的语言标签"。

**顺带清掉一个死文件**:`util/renderer/util/day.ts` 配了 dayjs 与 relativeTime 插件,
但**全仓零导入方**,而且里面注释掉的 locale 配置会让人误以为已有语言支持。
删掉后 typecheck 与 lint 仍过,坐实无人使用。(它未被导入,所以本就不在打包体里,属卫生问题。)

守卫扩到日期格式(同一个 spec,共 4 条),**验过有牙齿**。

### 深色模式:跟随系统的链路查通了,但首帧有一次白闪(第 111 轮)

要求 #7 此前只验过"打开时是暗的"(静态对比度),**没验过运行中切换系统主题会不会跟随**。
把链路查完:

- `tauri-bridge/theme.ts` 的 `initThemeController` 监听
  `matchMedia('(prefers-color-scheme: dark)')` 的 change,选择为 'system' 时实时应用;
  另有 `mt::set-theme` 处理原生 Theme 菜单。**默认选择就是 `'system'`。**
- **Rust 侧没有任何主题处理**——整条链依赖 WebView 自己更新 `prefers-color-scheme`。
- 因此**决定性的检查点是窗口主题有没有被钉死**:查了 `tauri.conf.json`,
  窗口与 app 层的 `theme` **都未设置**,所以 Tauri 跟随系统、WebView2 也跟随。
  **链路在源头是通的**(实际生效仍需目视确认)。

**但查出一个真实缺陷**:`index.html` 里既无背景也无 `color-scheme` 声明,
所以从导航开始到应用样式表生效的那约 500 ms,页面是**默认白色**——
深色模式下就是窗口深灰 → **白闪** → 编辑器深色。**这正压在"适配深色模式"这条要求上。**
已加 `<meta name="color-scheme" content="light dark">`,让浏览器按系统偏好选画布颜色。
**没有在这里硬编码应用自己的主题色**:那套颜色在还没加载的样式表里,
写死等于多出第三份需要同步的意见。

**另一处记录但不动**:`tauri.conf.json` 的 `backgroundColor` 钉死为 `#282828`(深灰)。
深色模式下无闪烁,**但浅色模式用户会先看到 1–2 秒深灰**(那正是 WebView2 启动的那段)。
要修得在 Rust 侧按系统主题动态设置,**而本机无法验证该 API,且这是个需要目视权衡的取舍**——
当前值偏向深色模式,与要求 #7 一致,所以保留并记录。

### 那个间歇失败:不再查成因,直接消除机制(第 106 轮)

`pdf.spec.ts` 在全量并发下**第二次**出现失败(两次都是 2 条,单独跑必过),
两次都耗掉我做归因。成因始终查不出:`beforeEach` 明明设了 `window.marktext`。

**换个做法——不查成因,消除唯一可能的机制**:该文件首个用例 `delete` 掉两个全局对象后
**靠下一个 `beforeEach` 兜底恢复**,是隐式清理。改成 try/finally 显式归还。
改后连跑 3 次全量 850 全过。**借了全局不还,是这里唯一能让全局消失的东西。**

**订正(第 111 轮):3 次全绿不足以断言它治好了,而它确实又出现了一次。**
本轮全量跑了 **14 次,失败 1 次**(此前约 20–25%,现约 7%)——
**频率降低,但没有消除**,而且这次**没抓到是哪条用例**(失败那次的输出没留存,
之后连跑 12 次都没能复现)。
**当前诚实的状态:那处改动去掉了一个合理的机制并降低了频率,但成因仍未确证。**
下次再遇到,**第一件事是把失败输出存盘**,而不是立刻复跑。

### 那 372 ms 查明了:就是 Vue 的重渲染(第 113 轮)

第三次换探针才测到。用 `queueMicrotask` 排在 Vue 的 flush 之后、命令存储续体之前,
**顺序由入队时刻决定**。用户日志:

    mounted        +487 ms
    shell flushed  +694 ms   ← 207 ms,全部是 flush
    microtasks drained +695 ms  ← 只剩 1 ms

**假设成立**:`onMounted` 里的 `SET_USER_PREFERENCE(initialState)` 触发整壳重渲染。
而那 5 个字段来自打开窗口的 URL,**挂载前就已知**——等于先用默认值渲一遍、改偏好、再渲一遍。

**改法**:挪到 `main.ts` 里 `app.mount()` **之前**。首屏直接带正确偏好渲染,第二遍消失。

**前两次探针为什么测不到**(记下来,别再犯):
`nextTick` 会挂到 flush 的 promise 上,因此排在续体**之后**,落在它本要界定的标记后面;
`onUpdated` 钩子在它挂载的子组件**之后**运行,Tauri 下第一次重渲染正是挂载编辑器那次,
于是它排在 `editor ready` 之后——而那时记录已关闭,**它在任何一份日志里都没出现过**。
**四次同一种错:放埋点前没先想清楚它在事件顺序里的位置。**

### 启动的最终账(第 113 轮,总计 2210 ms)

| 段 | 耗时 | 性质 |
|---|---|---|
| 进程 + 插件 | 67 ms | — |
| **窗口创建 + WebView2** | **1048 ms** | **不可控,Web 技术栈地板** |
| 菜单 | 55 ms | — |
| 取 + 编译 1904 KB | 417 ms | 已多轮削减,边际递减 |
| **Vue 重渲染** | **207 ms** | **本轮已消除** |
| 命令表 + 监听 + 引导 | 57 ms | — |
| 建引擎 + 渲染 8 KB 文档 | 324 ms | 内容相关,二次方已修 |

**同一台机器上 pre-JS 在 1048–2830 ms 之间波动(近 3 倍)**,是最大的单项且不受代码影响。
判断"是否变慢"必须**逐段看比例**:若各段同比例缩放即为机器差异,
若个别段单独变大才是代码回归(第 112 轮用这个方法排除了一次误判)。

### 启动动画:用户体验的那一半,和它测出来的边界(第 114 轮)

用户的原话是"先打开应用、加启动动画、再异步拉起 webview"。**前半句在 Tauri 下不成立**:
Tauri 窗口就是一个 WebView,没有第二个原生绘图层,所以能画出的第一帧
**必然是文档自己画出来的那一帧**。第二个 WebView 也救不了——它同样要等 WebView2 起来。

**能做的是同一件事的另一半**:那一帧此前是空的(`<div id="app"></div>` 之外什么都没有),
于是窗口在 WebView2 交接到 Vue 首渲之间白坐 ~1.1 s。把动画**内联写进 `index.html`**
——无脚本、无样式表、无图片,每一样都是一次往返,而一次往返就会让它落到它本要遮盖的应用后面。
`util/splash.ts` 负责撤下,由**真正画出第一屏内容的那一方**触发:
有文档时是编辑器排版完成,无文档时是最近文件页,设置窗口是设置树挂载。
三者都可能永远不发生,所以 6 s 兜底是必需的,不是保险。

**一个被测量推翻的担心**:Vite 把 272 KB 应用样式表注入 `<head>`,那是渲染阻塞的,
看上去会把 splash 一起挡住。做了对照(同一份产物,link 在 head vs 挪到 body 且排在 splash 之后,
各 7 次取中位数):**6× CPU 降速下 164 → 152 ms,不降速 44 → 40 ms**。
即 272 KB CSS 的取+解析只值 ~12 ms,不值得为它承担 `#app` 之下放样式表的 FOUC 风险。
**Vite 的注入位置保持不动。**

顺带:splash 的背景走 `prefers-color-scheme`,与 `tauri.conf.json` 的 `backgroundColor`
(#282828)对齐,单测把这两个值锁在一起——第 111 轮记的"首帧白闪"应当因此消失,
但**未经目视确认,不要当成已修**。

### `pdf.spec.ts` 的间歇失败:第三次查,这次拿到了机制(第 114 轮)

前两次都在几次绿跑之后结案,都复发了。这次先存下失败输出再复跑,拿到的机制是:
`beforeEach` 里的 `vi.resetModules()` 让**每个用例**重新导入 `@/util/pdf`,
而它拉进整个 `@muyajs/core`。verbose 计时:**首次导入在空闲机器上 2431 ms,
用例预算是 5000 ms**。全量并发时挤过 5000 ms 就超时;超时把用例丢在
`delete window.marktext` 和归还它的 `finally` 之间,后面三个用例接连报 undefined
——这正是前两次看到却归不了因的连锁。

`resetModules` 本身多余:`pdf.ts` 的 `window.*` **全部在 `getCssForOptions` 调用时才读**,
静态导入照样看得见用例赋的值。改成静态导入后,冷导入落在文件的 import 阶段
(不受用例超时约束):首个用例 **2431 → 6 ms**,该文件 test 时间 3.12 s → 51 ms,
整个单测套件 ~35 s → ~20 s。归还改到 `afterEach`,被丢弃的用例再也带不倒后面的。

**方法上的教训(第三次才做对)**:先存失败输出,再用 `--reporter=verbose` 看**逐用例耗时**。
2431 ms 这个数字一出来,因果就是明摆着的;前两次没看它,才会把"跑绿了几次"当成证据。

### macOS DMG 打包的偶发失败(第 114 轮,记录待复现)

发 v1.0.0 时,同一个 commit(`322a0e57`)被两条流水线同时构建——合并进 develop 触发一次,
打 tag 触发一次。**tag 那次 macos-x64 成功并产出 dmg;develop 那次同一个 leg 失败**:

```
Bundling marktext-light_1.0.0_x64.dmg
Running bundle_dmg.sh
failed to bundle project: error running bundle_dmg.sh
```

**同一份代码一成一败,所以是偶发,不是回归。** 不要因为看到红叉就去改代码。

影响有限:`tauri-build.yml` 的 release 作业是 `if: always()`,缺一个平台不挡发版;
且重跑同一个 tag 会 `gh release upload --clobber` 补上缺的那个,不会推倒重来。
真要治,方向是给 `Build Tauri app` 这一步加重试,**但先要攒到第二次复现**——
现在只有一次,连是不是 `hdiutil` 争用都不知道。

### 打开文件时丢掉了编码、BOM 与行尾(第 115 轮)

`read_file` 解的是**严格 UTF-8**,桥再把一个裸字符串交给渲染层。由此有两个 bug,
其中一个是静默的。

**BOM(静默,更糟)**:Notepad 存的 UTF-8 带 BOM,打开后 U+FEFF 成了文档第一个字符。
拿引擎自己的 lexer 验的,不是推的:

```
"# Title\n"          -> ["heading", "space", "paragraph"]
"\ufeff# Title\n"    -> ["paragraph", "space", "paragraph"]
```

**首个标题降级成段落**,而且 BOM 原样写回磁盘,所以每次重开都再错一次。

**旧编码(响亮)**:GBK / Big5 / EUC-KR / Shift_JIS 的文件**根本打不开**,
报的是 `invalid utf-8 sequence of 1 bytes from index 41`——读者无从下手。

Electron 两样都没有:`main/filesystem/encoding.ts` 嗅 BOM、`ced` 猜其余,
`loadMarkdownFile` 返回的文档带着编码、行尾与末尾空行数。**这些字段
`MarkdownDocument` 和 tab state 里一直都有,保存侧也一直在读**——`save.ts` 特意
拒绝转码非 UTF-8 文档,就是为了不悄悄改写。**桥从来没填过,所以那个拒绝永远触发不了,
CRLF 文件存回去就变成了 LF。**

**修法**:`commands/markdown.rs` 重建加载器。顺序照抄 Electron 且理由相同——
BOM 是证据所以最优先;其次有效 UTF-8 一律当 UTF-8,**哪怕统计检测器另有偏好**
(#3151 里希腊字母被认成 GBK 变成汉字,就是这一条防住的);剩下的才交给
chardetng(Firefox 用的那个)。

**两处是被测试逼出来的,不是想出来的**:

1. **二进制会被解成乱码**。检测器**永远**给得出一个答案,所以原先被
   `String::from_utf8` 拒掉的改名 PNG 会「打开」成一屏噪声。改成遇 NUL 字节即拒,
   与 Electron 判据一致。
2. **`C4 E3 BA C3` 这四个字节,chardetng 猜的是 EUC-KR(콱봤)而非 GBK(你好)**。
   两种读法都成立,字节本身不含答案。`guess()` 有个地区提示参数正是为此——
   用 OS 界面语言推出来传进去(`sys-locale` 本来就在依赖里)。
   **单行文件就靠这个定夺。**

**本机没有 Rust,这半边只能由 CI 验**:13 条 Rust 单测在 CI 的 Linux 作业跑通,
四平台编译通过。渲染层 866 条本地通过。

## 下一步（按优先级）

1. **深色模式目视验收**（唯一悬着的用户要求）：本机 sudo 需密码、装不了 webkit2gtk，
   静态审查已做尽（见下）。需在有 webkit2gtk 的机器上跑 CI 产物的安装包人工确认。
2. **自动更新**（6 个通道）：需 `tauri-plugin-updater` + 签名密钥 + 更新服务器，属发布基建。
   **但它是「干净地缺席」而不是「静默地坏掉」**（第 104 轮查证）：Rust 的 `boot_info`
   返回 `is_updatable: false`，命令面板项被 `if (isUpdatable())` 挡住从未注册，
   原生菜单与自绘菜单栏里都没有「检查更新」。**没有点了没反应的死 UI，不需要"先补个降级提示"。**
   阻塞的只是密钥与服务器这两个决策——Rust 插件本身不需要 `pnpm install`（CI 编译即可），
   渲染层也能绕开 JS 包直接 `invoke`。
3. **拼写检查**：**这条的「5 个通道硬缺口」说法已过时**。逐条查证后只有
   `spellchecker-get-available-dictionaries` 是真缺口，其余 4 个由系统 WebView 接管
   （见文件开头的三分表）。仍缺的是词典列表、应用内切换语言、右键改正。
4. ~~**pandoc 导入**~~ —— **已经做完了，这条记载过时**。Rust 侧
   `commands::cmd::pandoc_to_markdown` 已注册（`lib.rs:77`），桥内 `import.ts` 的
   `canImportWithPandoc` / `importWithPandoc` 已接，拖入 .docx 也走这条路。
5. **原生菜单状态回显**：自绘菜单栏已有勾选态；macOS 的原生菜单仍无，需 Rust 侧持句柄 `set_checked`。
   仅影响 macOS，本机与用户（Windows）都无法目视验收。
6. ~~**E2E 覆盖要求 #4**~~ —— **这条做不到，不要再试**。E2E 跑的是 Electron，而
   **Electron 版本本来就会恢复标签页**（主进程持久化 buffered state + `startUpAction:
   'restoreAll'`）。要求 #4 只在 Tauri 侧成立：桥把 `update-buffer-state` 放进
   `IGNORED_INVOKES`，快照写出去就丢掉。这是**有意为之且已写明理由**的，
   `no-tab-restore.spec.ts` 已从两个方向锁住（写侧被忽略、读侧无 `mt::load-state`）。
   在 Electron 里断言「标签页不恢复」只会得到一个必然失败的用例。
7. ~~**大文件的渲染侧**~~ —— **这条的数字已过时**。原文写「渲染约 11–13 ms/KB，近似线性」，
   那是**纯散文**的数字。第 94 轮测出成本主要取决于**内容类型**：同为 60 KB，
   代码块曾是 44 ms/KB（散文 5.8）。两个修复后代码块降到约 9.9 ms/KB 且曲线变平。
   **能靠局部修复拿的都取完了**（第 96 轮逐条查证：公式/表格/列表都线性，无 bug）。
8. ~~**首屏那 393 ms**~~ ✅ **第 113 轮结案**：确实是 Vue 重渲染（207 ms），
   偏好改到 `app.mount()` 之前后消失。第 114 轮 CI 日志复核：
   `mounted 255 → shell flushed 279`，只剩 24 ms。**不要重开。**
9. ~~**入口 CSS 的 372 KB Element Plus**~~ ✅ 第 85 轮已做，372.5 → 132.7 KB。
   **待目视确认样式没塌**——这是本机验不了的那一半。

### 只有用户能做的三件（材料都已备好）

- **目视确认样式没塌**：CSS 裁掉 242 KB，E2E 查得出 DOM 与对比度、查不出布局崩坏。
  重点看对话框、侧栏树、下拉菜单、标签页、设置窗的表格与下拉框。
- **同一个包连跑两次**：判断「越来越慢」是否为新未签名二进制的首次扫描代价。
  渲染层在最近两份日志间几乎没变（2134 → 2158 ms），涨的是 JS 之前那段（1018 → 2830 ms）。
- **Electron 与 Tauri 并排读内存**：Electron 基线 608 MB（四进程，CI Linux）。
  Electron 包在 `PR Build` 的 `marktext-windows-x64` 产物里，不需另外构建。
  **Tauri 侧务必把 `msedgewebview2.exe` 的进程一并计入**，否则是拿一个进程比四个。

### 架构级：不要在定时迭代里动

每一件的验证量都远超一轮，**建议单独开专门会话**：

- **vnode 直接 patch DOM**：现在 `patch()` 把 vnode 序列化成 HTML 字符串再交给
  `innerHTML`，浏览器重新解析。一次击键里浏览器内部开销占 68%（第 99 轮实测）。
  改它牵动每种块类型、光标处理与一致性套件。
- **可视区虚拟化**：布局成本随文档线性且每次击键一次，这是长文档的固有重排。
- **自动更新基建**：签名密钥 + 更新服务器，需要决策而不只是编码。

### 已关账，不要重开

- **通道差距**：116 个通道实现 92，剩 9 个真缺口（自动更新 6、截图 2、词典列表 1），
  **没有一条是「还没做」的普通功能**。拼写检查的 5 个通道里只有词典列表是真缺口，
  其余 4 个由系统/WebView 接管（上文第 3 条的「5 个通道硬缺口」说法已过时）。
- **`addRange`**：profile 里最大的一项（29–33%），**两次不同尺寸的实验都证明不可回收**
  （第 82 轮 2400 块、第 91 轮 12000 块）。不要再查第三次。
- **样式重算**：打字时为 0–1 ms，**选择器问题已排除**（第 99 轮）。
- **`mounted → microtasks drained` 的静态排查已做尽**（第 105 轮）：挂载期间在 `await`
  之前只有两件事——`SET_USER_PREFERENCE`（5 个 URL 参数字段）与 `LISTEN_WIN_STATUS`
  （**只注册一个监听器**）。两者都不足以解释 393 ms。**只能等 Tauri 侧 `shell updated` 的落点。**

**顺带发现的一处小重复（29 ms，记录但不动手）**：非英文环境下命令表会建**两次**。
`i18n/index.ts` 模块级发 `mt::get-current-language` → 桥回 `mt::current-language`
→ `setLanguage` → `bus.emit('language-changed')` → 命令中心重建 83 条描述。
第二次**不是冗余**（描述要重新翻译），浪费的是第一次那个英文版。
命令表构建实测 29 ms，**不值得为此改动启动顺序**；若将来要动，方向是把首次构建推迟到语言确定之后。
- **桥的静默路径**（第 102 轮审计）：差距脚本只看通道名在不在桥里，所以
  **被有意忽略、或 case 体为空的通道会被算成「已实现」**——这是比假阳性更危险的假阴性。
  查了：`IGNORED_INVOKES` 只有 `update-buffer-state` 一条（要求 #4，有意为之）；
  `handleSend` 的 51 个 case 里 10 个看似为空，逐条查证后
  **1 个是 fall-through（实现在下一个 case）、2 个是写明理由的有意丢弃
  （`window-initialized`、`window::drop`）、7 个是同一组原生菜单状态回显
  （已作为「下一步」第 5 条跟踪）**。**没有隐藏缺口,不必再审。**

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
