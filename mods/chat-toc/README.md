# chat-toc（开发者说明）

chat-toc 是一个 Claude Code 插件：在全屏终端里把当前会话的对话目录停靠在 transcript 右侧，点击条目跳回那一轮。

- 使用说明（环境要求、安装、操作、显示规则、隐私、卸载、已知限制）只写在[根 README 的 chat-toc 一节](../../README.md#chat-toc)，本文件不重复。
- 领域术语（Transcript、Turn group、User input、Agent reply、View filter、Layout、Current position、Jump target）见 [`CONTEXT.md`](CONTEXT.md)。代码和本文件用这些术语；面向使用者的文字一律用界面上的字。
- 规格与票据：`.scratch/chat-toc/spec.md`、`.scratch/chat-toc/issues/`。

与 prompt-history 互不依赖、不共享代码和数据；需要的部分各写一份，不抽公共库。

## 目录结构

```text
mods/chat-toc/
├── .claude-plugin/plugin.json   name chat-toc、version、"types": "./types/index.d.ts"
├── .claude/types/claude-code.d.ts   2.1.287 的宿主类型声明（tsc 用它查最低版本）
├── types/index.d.ts             $.state 的契约（成员必须内联写在 PluginState['chat-toc'] 里）
├── hooks/
│   ├── hooks.json               只加载 ./register.tsx
│   ├── register.tsx             所有碰 $ 的代码与全部 hook；其余文件都是纯函数
│   ├── transcript.ts            解析 JSONL 行
│   ├── chain.ts                 当前分支的对话链（parentUuid，compact 边界改沿 logicalParentUuid）
│   ├── groups.ts                开组规则、用户侧文字、步数、末段、结局
│   ├── regroup.ts               增量重组（只从末组开组行起重组）
│   ├── model.ts                 整份重组；只作测试判据，register 不用
│   ├── source.ts                ≤4 MiB 整读与 4,000,000 B 分块读（sh dd+head / Windows PowerShell 5.1）
│   ├── reader.ts                300 ms 尾随、读时合并的闸门
│   ├── entries.ts               三种 Layout 与 View filter 的条目、时间格式、Agent 侧状态字
│   ├── table.ts                 条目表：按组缓存条目，只在数据、宽度、过滤、Layout 变化时重建；组到条目查表
│   ├── cells.ts                 终端单元宽度与折行
│   ├── window.ts                Pane 自管的可见窗口
│   ├── ring.ts                  宿主焦点环落在条目第一行、窗口两端的滚动
│   ├── view.ts                  View filter / Layout 的 $.store 键、认不出时回默认
│   ├── sites.ts                 transcript 站点记录与 requestId → 行的四级匹配
│   ├── jump.ts                  每一侧的跳转候选、被拒说明与淡化
│   ├── position.ts              Current position：在屏行分段、二分查找、跳转锁定
│   ├── perf.ts                  CHAT_TOC_PERF 下的耗时采样（只有数字），写进宿主 debug 日志
│   ├── lifecycle.ts             关闭标记、重开时机、放置结果、状态栏文字
│   ├── locate.ts                中途启用时推算 transcript 路径（宿主的项目目录命名规则）
│   └── pane.tsx                 Pane 的绘制（过滤行、条目、底栏）
└── tests/
    ├── *.test.ts                claude plugin test 套件
    ├── fixture.ts、host.ts      合成 transcript 构造器；test kit 之上的宿主替身
    ├── acceptance/              独立 verifier、fixture 生成器、PTY 驱动与各场景脚本
    └── evidence/<版本>/          发布证据（随发布提交出现）
```

宿主有一条加载期静态检查：`$` 只能传给 `register.tsx` 顶层声明的函数，写成 `$.noun.method(...)`。传给 import 进来的函数或闭包会让模块加载失败，所以新代码里碰 `$` 的部分一律放进 `register.tsx`。

## 本地加载

```sh
claude --plugin-dir /path/to/cc-mods/mods/chat-toc
```

- 不需要 `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS`。全屏布局用 `/tui fullscreen` 打开（或设置里 `"tui": "fullscreen"`）。
- 热重载：在 `--plugin-dir` 下改动（或 touch）`hooks/register.tsx`。`/reload-plugins` 对没改动的 hooks 模块不重载（debug 日志 `hooks modules unchanged, kept as loaded`）。
- 看插件做了什么：启动时加 `--debug-file <路径>`，日志里有 `hooks module chat-toc@inline reloaded`、`ui.open chat-toc chat-toc (unasked|asked, N columns): …`、`ui.close …` 等行。
- 量耗时：再加环境变量 `CHAT_TOC_PERF=1`，插件把读取、重组、Pane 重画、Current position 的耗时以 `chat-toc-perf {...}` 行写进 debug 日志，每秒最多一批。只有数字（毫秒与计数），没有 prompt、uuid、路径；不设这个变量时什么都不量、不写。
- 与 marketplace 安装不要同时启用。

最低兼容版本 2.1.287 不装到全局，二选一：

```sh
npm install --prefix <临时目录>/cc287 @anthropic-ai/claude-code@2.1.287   # 二进制在 node_modules/.bin/claude
npx -y -p @anthropic-ai/claude-code@2.1.287 claude ...                     # PTY 驱动的 Host("2.1.287") 走这条
```

## 自动化测试

快速门禁 `mods/chat-toc/scripts/verify-startup.sh`（约 20 秒）把下面这些和验收工具的单元测试串起来跑，两个版本都走 `npx`，不用本机全局安装。仓库的 pre-commit 钩子（`.githooks/pre-commit`，每个 clone 执行一次 `git config core.hooksPath .githooks` 启用）在提交改到某个 mod 的非 Markdown 文件时跑那个 mod 的门禁。

单独跑某一项，在仓库根目录：

```sh
claude plugin test mods/chat-toc                 # 只要求当前版本通过
claude plugin validate mods/chat-toc             # 当前版本
<cc287>/node_modules/.bin/claude plugin validate mods/chat-toc   # 2.1.287
(cd mods/chat-toc && npx -y -p typescript@5.6.3 tsc -p tsconfig.json)   # 对 2.1.287 的类型声明
```

- 2.1.287 的 test kit 没有 `session.append` 的底层实现，依赖它的用例只在当前版本上跑。
- test kit 不把插件对 transcript 的 `$.ui.scroll` 和插件自己的 `$.ui.focus` 交给测试的 hook（报 no implementation），也触发不了使用者的 ✕。跳转、焦点落点、使用者关闭这几样在纯函数上测，真实效果靠 PTY 验收。
- 要求「自动打开」的用例必须先画一次提示行（`tests/host.ts` 的 `start()` 已经做了；手动触发启动事件时调用 `drawHint($)`），因为全屏与否从 `PromptHint` 的绘制里才知道。
- 对 2.1.295 等新版本做类型检查：在插件外写一个 tsconfig，包含 `plugin-authoring` skill 给出的 `types/claude-code.d.ts` 和 `mods/chat-toc/{types,hooks,tests}`。

验收工具自身的单元测试（verifier、fixture 生成器、驱动），只用标准库：

```sh
cd mods/chat-toc/tests/acceptance && python3 -m unittest test_toc_verifier test_transcript_fixture test_pty_harness
```

## PTY 验收

第二层验收在真实宿主里跑，判据是 `tests/acceptance/toc_verifier.py`：它独立地沿 transcript 文件的对话链算出期望的条目序列，与 Pane 上读到的条目逐条比对，不与插件共享实现。

**环境**。驱动终端需要 pyte，版本见 `tests/acceptance/requirements.txt`：

```sh
python3 -m venv <venv> && <venv>/bin/pip install --require-hashes -r mods/chat-toc/tests/acceptance/requirements.txt
PY=<venv>/bin/python
```

每次启动都在临时的 HOME 与 `CLAUDE_CONFIG_DIR` 里：已过引导、项目已信任、全屏、除 `--plugin-dir` 给的之外没有任何插件、不登录。不碰本人的 `~/.claude`。不登录时可以 `--resume` 合成 transcript、点击、滚动、跑本地斜杠命令，提交的 prompt 也会写进 transcript（宿主自己回一行 `Not logged in · Please run /login`），都不调用模型。确实需要真实一轮时设 `CHAT_TOC_PTY_TOKEN`（`claude setup-token` 的 token），驱动会以 `CLAUDE_CODE_OAUTH_TOKEN` 传入并加 `--model haiku`。只用合成 prompt，不放真实会话内容。

**场景脚本**（仓库根目录执行，`--host` 取 `2.1.287` 或 `current`，后者是 PATH 上的 `claude`）：

| 场景 | 命令 |
| --- | --- |
| 冒烟：整列表与 verifier 一致、点击跳转 | `$PY mods/chat-toc/tests/acceptance/pty_harness.py smoke --host 2.1.287 --plugin mods/chat-toc [--fixture forms] [--terminal cmux]` |
| CT-COMPAT-003 | `$PY mods/chat-toc/tests/acceptance/ct_compat.py --host 2.1.287 --host current [--scenario waiting\|narrowed\|asked\|main\|reload]` |
| CT-LIFE-001、002、005（fork） | `$PY mods/chat-toc/tests/acceptance/ct_life.py --host 2.1.287 --host current [--scenario 001\|002\|fork]` |
| CT-LIFE-007 | `$PY mods/chat-toc/tests/acceptance/ct_mid_session.py --host 2.1.287 --host current [--scenario cli\|ui]`（从运行目录里临时搭的目录 marketplace 安装并先禁用，再分别用 CLI 和 `/plugin` 界面在会话中途启用） |
| CT-LIFE-003、004、005，CT-DATA-006 | `$PY mods/chat-toc/tests/acceptance/chain_scenarios.py --host 2.1.287 [--only life-003,...]` |
| CT-JUMP-001～003、005，CT-UI-005 | `$PY mods/chat-toc/tests/acceptance/jump_scenarios.py 2.1.287 [001 002 002b 003 005]`（005 同时记录 CT-UI-005：约每 30 ms 读一次提示行的反色与前景色） |
| CT-POS-001～003、CT-COEX-001、CT-LIFE-006 | `$PY mods/chat-toc/tests/acceptance/position_scenarios.py 2.1.287 [pos1 pos2 pos3 coex life6]`（coex 在临时项目里 `git init` 一份有改动的仓库，`/diff` 才会打开） |
| CT-PERF-001（20 MiB many/heavy，各跑 3 次） | `$PY mods/chat-toc/tests/acceptance/perf_scenarios.py run 2.1.287 many --runs 3`（再换 `heavy`、`current`）；汇总成发布报告的表：`$PY mods/chat-toc/tests/acceptance/perf_scenarios.py table <运行目录>...`。3000 条残留在屏记录下的 Current position 与条目表在 `tests/long_session.test.ts` 里量（`claude plugin test` 输出 `CT-PERF` 行） |
| CT-COMPAT-001，CT-DATA-001～005，CT-TURN-001～005，CT-UI-001～003，CT-SEC-001 | `$PY mods/chat-toc/tests/acceptance/gate_scenarios.py --host 2.1.287 [--only compat-001,data-002,forms,turn-004-live,ui-003,sec-001,...]` |
| CT-COMPAT-002（marketplace 冒烟） | `$PY mods/chat-toc/tests/acceptance/ct_marketplace.py --host 2.1.287 --host current --source local\|github`（`local` 是本仓库目录，发布前跑；`github` 是 `lkangd/cc-mods`，发布后的安装级检查） |
| 三种 Layout 截屏（人工目检用） | `.scratch/chat-toc/assets/25-layouts/capture.py`（另有 `check_screens.py`、`probe.py`、`remember.py`、`ring_check.py`） |
| 整个发布门禁 | `$PY mods/chat-toc/tests/acceptance/release_gate.py run --host 2.1.287 --gate <目录> --screens`（当前版本另加 `--types <claude-code.d.ts>`），两个版本可以并行；再 `release_gate.py report --gate <目录> --out mods/chat-toc/tests/evidence/<版本> --commit <被测提交> --screens` 生成证据目录 |

CT-TURN-004 的「进行中 · N 步」要一轮真正在跑：`gate_scenarios.py` 的 `turn-004-live` 用 `fake_api.py`（本机一个按脚本应答的 Messages API 替身，`ANTHROPIC_BASE_URL` 指向它）跑两步 Read 再收尾，不调用模型。fixture 生成器 `transcript_fixture.py` 有 `forms`（规格点名的全部行形态）、`turns`、`many`（20 MiB 约 4500 轮）、`heavy`（20 MiB 约 108 轮、大工具结果）四种，种子固定。

**cmux**。场景脚本默认用 pyte（无头、尺寸可控、能读颜色）。要在 cmux 里看着跑，`pty_harness.py smoke --terminal cmux` 会在当前 workspace 开一个 `--focus false` 的分屏，结束时关掉；只动自己开的分屏。注意：

- cmux 分屏的宽度不受控，不足 144 列不会自动停靠，smoke 会改用 `/chat-toc`（110 列起停靠），transcript 里因此多一组。
- cmux 发出的滚轮和点击序列也会被宿主当成 Escape：每次点击可能弹出 rewind 对话框，一轮进行中滚动 Pane 会中断这一轮。整列表比对用 pyte。
- 宿主把 `dimColor` 画成当前主题的 `inactive` 前景色（不是 SGR 2；验收世界是 dark 主题，即 `999999`）；悬停的条目是反色。在 pyte 里判断淡化前，先把指针移开。

**运行记录**。每次运行写到 `mods/chat-toc/build/pty-runs/<时间>-<标签>/`（gitignore）：`run.jsonl` 每个场景一行（场景 ID、Claude Code 版本、插件、fixture、预期、实际、结果、证据、OS、架构、时间），`screens/` 是截屏文本。发布时只把选中的运行目录拷进证据目录。

## 证据目录

- `tests/evidence/<插件版本>/`，一个版本一个目录，提交进仓库。改版本号就在新目录里重跑完整 MUST 门禁，旧目录不改。不建 CHANGELOG。
- 目录里放三个文件：
  - `report.md`：给人看，两个 Claude Code 版本合在一份里、按版本分列，含人工目检签字；
  - `report.json`：每个场景一条，字段为插件版本、Claude Code 版本、OS、架构、fixture、场景 ID、预期、实际、结果、证据链接，另记被测提交的哈希；
  - `marketplace.md`：本地目录 marketplace 冒烟（CT-COMPAT-002）与发布后 GitHub 安装级检查的结果。
- 场景清单与 MUST 等级以 `.scratch/chat-toc/issues/06-grill-acceptance-contract.md` §4 为准。任一 MUST 失败、缺失、跳过，或没有可追溯证据，都不能发布。
- 证据里只有合成 prompt。CT-SEC-001 的唯一标记不得出现在证据里。

## 发布清单

按顺序勾选，任何一步失败就停在那一步：

1. [ ] `plugin.json` 的 `version` 已改成要发布的版本；新建 `tests/evidence/<版本>/`。
2. [ ] 在本机 macOS 上用 2.1.287 和当时的当前版本，以 `--plugin-dir` 各跑一遍全部 MUST 场景：零失败、零缺失、零跳过；`claude plugin test`、两版 `validate`、两版 `tsc` 干净。
3. [ ] 用本地目录 marketplace 在两个版本上跑 CT-COMPAT-002 冒烟（安装、Pane 自动弹出、点击一次用户侧并跳转成功），写进 `marketplace.md`。
4. [ ] 人工目检三种 Layout 的观感、高亮（主题的 `suggestion` 色）与反色选择光标能否分清，在 `report.md` 签字（不阻断发布）。
5. [ ] 发布提交：在**同一个提交**里加入 marketplace 条目（`.claude-plugin/marketplace.json`，`name`/`source`/`description`/`version`/`author`，不加 `category`、`tags`）、根 README 一览表的一行与 chat-toc 一节（改版本时更新那一行和「开发」里的通过结果）、`tests/evidence/<版本>/`。不打 git tag。
6. [ ] 推上去后，先确认 `gh repo view lkangd/cc-mods --json defaultBranchRef -q .defaultBranchRef.name` 输出 `main`（`marketplace add lkangd/cc-mods` 读的是默认分支；0.1.0 第一次发布就因默认分支不是 `main` 而撤回），再从 `lkangd/cc-mods` 做一次安装级检查：`claude plugin marketplace add lkangd/cc-mods`、`claude plugin install chat-toc@cc-mods`、`claude plugin list` 里版本号正确且 enabled、全屏会话启动时 Pane 自动弹出。结果补进 `marketplace.md`（这一步不算重新发布）。本地目录 marketplace 直接运行源码目录，只有 GitHub 远程 marketplace 才复制到缓存，所以这一步不能省。
7. [ ] 第 6 步失败就撤回发布提交。
