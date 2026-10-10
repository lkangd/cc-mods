# 18: 独立 verifier 与 PTY 验收驱动

**What to build:** 搭好后续票共用的验收工具：一个不与插件共享实现的独立 verifier，直接沿 transcript 文件的对话链算出期望的 Turn group 序列，再与 Pane 实际列出的条目比对；一套 cmux 驱动的真实宿主 PTY 验收脚手架，能在隔离环境里以 2.1.287 与当前版本启动全屏会话、用合成 transcript `--resume`、点击、滚轮、发命令并读屏；以及合成 fixture 生成器（含 20 MiB 的 many 与 heavy 两种）。可以复用各决策票 assets 里的驱动、生成器与 pyte 读屏代码。

规格见 [chat-toc MVP](../spec.md) 「Testing Decisions」。

**Blocked by:** 无（可以立即开始）

**Status:** resolved

- [x] verifier 独立实现对话链（`parentUuid`、compact 边界改沿 `logicalParentUuid`）与开组规则，输出期望的条目序列
- [x] verifier 能读取 Pane 实际列出的条目（读屏或插件导出的测试视图）并给出逐条差异
- [x] PTY 驱动能在两个版本上以隔离配置（关掉本机其他插件）启动全屏会话、`--plugin-dir` 加载插件，支持点击、滚轮、键入命令、读屏与截屏存档
- [x] 合成 fixture 生成器能产出普通 prompt、斜杠命令（两种行）、`!cmd`、compact、rewind 分支、子 agent、中断、出错、无时间戳等形态，以及 20 MiB 的 many（约 4400 轮）与 heavy（约 110 轮、大工具结果）
- [x] 只用合成 prompt，不含真实会话内容；尽量不调用模型
- [x] 每次运行产出可追溯的日志，字段能直接进入发布报告（场景 ID、预期、实际、结果、证据链接）

## Comments

2026-10-10 实现于 `mods/chat-toc/tests/acceptance/`（分支 `chat-toc/18-harness`）：

- `toc_verifier.py`：独立实现对话链与开组规则，输出期望条目；读卡片 Layout 的 Pane 窗口（`parse_pane`），逐条比对（`compare_window`），滚过整个列表后检查覆盖（`compare_windows`）。规格没写死的两处按字面取：出错轮的 API Error 文字算作末段；普通 prompt 没有任何 assistant 行时 Agent 侧显示「无文字回复」。
- `transcript_fixture.py`：`forms`（规格点名的全部行形态）、`turns N`、`many`（20 MiB 约 4500 轮）、`heavy`（20 MiB 约 108 轮）；种子固定，逐字节可复现。
- `pty_harness.py`：隔离的 HOME/CLAUDE_CONFIG_DIR（不登录、不加载本机插件、全屏），`Host("2.1.287")` 走 npx 缓存；pyte 与 cmux 两种终端；`Run` 写 `run.jsonl`（场景 ID、版本、OS、架构、fixture、预期、实际、结果、证据）与每屏截图到 `mods/chat-toc/build/pty-runs/`（gitignore）。
- 单元测试 40 个（`python3 -m unittest`）。端到端用 05 号原型改成只收 label 的替身（只在 scratchpad，不提交）证明：pyte 下 2.1.287 与 2.1.295 的 `smoke`（40 轮，整列表 18 个窗口逐条一致，点击 T0000 跳转成功）都通过；cmux 下 2.1.287 通过。`forms` fixture 下 verifier 正确指出替身把 ✨ 算成 1 格导致的折行错位，其余形态全部一致。
- 合入 17 号 tracer 后对真插件跑 `smoke`（pyte，2.1.287 与 2.1.295）：Pane 识别、整列表读取、点击 T0000 跳转都正常；verifier 报出 tracer 尚未做的部分（没有 Agent 侧；`system/local_command` 的 `/tui` 与 `!cmd` 没有开组，导致其后条目错位），留给 19 号票，判据现成。
- 已知限制：cmux 下用 `cmux send` 发出的滚轮让替身 Pane 窗口来回跳，所以 cmux 默认不读整列表（`--whole-list` 可开）；整列表比对以 pyte 为准。cmux 分屏宽度不受控，不够 144 列时 smoke 用 `/chat-toc` 请求停靠。命令速查见共享笔记 `pty-harness.md`。

