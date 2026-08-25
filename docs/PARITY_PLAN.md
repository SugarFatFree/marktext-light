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

**基线 2026-08-25：116 个通道，实现 18 → 当前 44，缺 72。**
（复测命令见本文件末尾）

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
- `test/unit/specs/watcher-await-write-finish.spec.ts` 在本机**必然失败**：它要加载 Electron 二进制，
  而本机网络装不上（`Electron failed to install correctly`）。属环境问题，不是回归。

## 用户明确要求的验收点

| # | 要求 | 状态 |
|---|---|---|
| 1 | 多文件在**同一窗口以标签页**打开 | ✅ 桥内 `mt::open-file` + 单实例插件（Rust 待 CI 验证） |
| 2 | 默认显示左侧抽屉菜单页 | ✅ Tauri 自举 `sideBarVisibility: true` |
| 3 | 打开过的文件在左侧抽屉**持久留存** | ✅ `store/recentFiles.ts` + 侧栏「最近文件」区块 |
| 4 | 标签页**不**持久化 | ✅ Tauri 下无 buffered-state 通道，天然不恢复（待补 E2E） |
| 5 | 记录仅手动删除 | ✅ 单条 hover ✕ + 「清空最近文件」 |
| 6 | 国际化 | ✅ 10 语言键集完全一致，`locale-parity.spec.ts` 锁死 |
| 7 | 深色模式／跟随系统 | ⚠️ 已扫全部组件硬编码色并修掉两处真 bug；仍缺真实窗口目视验收 |
| 8 | 轻量／秒启动／低占用／大文件 | ✅ 启动首屏 −78%；大文件解析已回到**线性**（见下） |

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

| 阶段 | eager 入口 | 编辑器首屏静态闭包 |
|---|---|---|
| 优化前 | 3512 KB | 3512 KB |
| Element Plus + 路由懒加载后 | 762 KB | 2689 KB |
| CodeMirror + 主题懒加载后 | **762 KB** | **2469 KB** |

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

## 下一步（按优先级）

1. **文件 watcher**：项目树目前只在打开时扫一次。Rust 侧用 `notify` crate 监听，
   emit 与扫描同构的 `mt::update-object-tree` 事件即可（`tauri-bridge/project.ts` 已定好形状）。
2. **ripgrep 全文搜索**：桥内目前是 stub，侧栏搜索面板空转。
4. **E2E**：补「重启后标签页不恢复、最近文件仍在」的 Playwright 用例，锁住要求 #3/#4。
5. **大文件的渲染侧**：解析已线性，但打开一个大文档还要经过 muya 建块树 + snabbdom 渲染，
   那一段尚未测过（本地无 WebView，需在真实窗口里量）。内存也仍偏高：4 MB 文档解析后堆约 600 MB。

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
