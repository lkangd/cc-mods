# 18: 独立 verifier 与 PTY 验收驱动

**What to build:** 搭好后续票共用的验收工具：一个不与插件共享实现的独立 verifier，直接沿 transcript 文件的对话链算出期望的 Turn group 序列，再与 Pane 实际列出的条目比对；一套 cmux 驱动的真实宿主 PTY 验收脚手架，能在隔离环境里以 2.1.287 与当前版本启动全屏会话、用合成 transcript `--resume`、点击、滚轮、发命令并读屏；以及合成 fixture 生成器（含 20 MiB 的 many 与 heavy 两种）。可以复用各决策票 assets 里的驱动、生成器与 pyte 读屏代码。

规格见 [chat-toc MVP](../spec.md) 「Testing Decisions」。

**Blocked by:** 无（可以立即开始）

**Status:** ready-for-agent

- [ ] verifier 独立实现对话链（`parentUuid`、compact 边界改沿 `logicalParentUuid`）与开组规则，输出期望的条目序列
- [ ] verifier 能读取 Pane 实际列出的条目（读屏或插件导出的测试视图）并给出逐条差异
- [ ] PTY 驱动能在两个版本上以隔离配置（关掉本机其他插件）启动全屏会话、`--plugin-dir` 加载插件，支持点击、滚轮、键入命令、读屏与截屏存档
- [ ] 合成 fixture 生成器能产出普通 prompt、斜杠命令（两种行）、`!cmd`、compact、rewind 分支、子 agent、中断、出错、无时间戳等形态，以及 20 MiB 的 many（约 4400 轮）与 heavy（约 110 轮、大工具结果）
- [ ] 只用合成 prompt，不含真实会话内容；尽量不调用模型
- [ ] 每次运行产出可追溯的日志，字段能直接进入发布报告（场景 ID、预期、实际、结果、证据链接）
