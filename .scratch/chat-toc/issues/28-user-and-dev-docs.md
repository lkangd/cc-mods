# 28: 用户文档与开发文档

**What to build:** 想安装的人在根 README 里就能读到 chat-toc 的环境要求、安装、操作、显示规则、隐私、卸载和已知限制；开发者在插件自己的 README 里能找到本地加载、测试、PTY 验收和发布清单。

规格见 [chat-toc MVP](../spec.md) §10。

**Blocked by:** 21（对话链：compact、rewind、resume、fork）、23（完整跳转：Agent 侧、兜底与被拒）、25（View filter、三种 Layout 与键盘）、26（停靠条件与状态栏说明）

**Status:** resolved

- [x] 根 README 开头改为「每个 mod 是独立插件，互不依赖、不共享代码与数据，可以同时启用」；一览表新增 chat-toc 一行（版本先写 0.1.0，随发布提交一起出现）
- [x] chat-toc 一节与 prompt-history 同级，开头写两者的区别，然后按序：作用、环境要求（含「不需要 function hooks 环境变量」、OS 不限但只在 macOS 实测）、安装、快速开始、操作表、显示规则、数据与隐私、卸载（含残留 `$.store` 文件位置）、已知限制（不承诺八条）、开发
- [x] 用界面上的字，不出现 Turn group、Current position 等内部术语
- [x] 插件 README 只写开发内容：链接根 README 与 CONTEXT、目录结构、本地加载、`claude plugin test`、cmux PTY 验收、证据目录约定、发布清单（逐步勾选）
- [x] 文档描述与实际行为一致（逐条对照规格与已通过的验收）
- [x] 根 README 的 chat-toc 一节与一览表那一行留给发布提交一起进 main

## Comments

2026-10-11，分支 `chat-toc/28-docs`（基于 `chat-toc/mvp` ce384e1）。

- **根 README 没有改**。开头那句的改法、一览表那一行、完整的 chat-toc 一节都写成可直接粘贴的草稿 `mods/chat-toc/release/root-readme-section.md`，由 29 号在发布提交里贴进 `README.md`（与 marketplace 条目、`evidence/0.1.0/` 同一个提交）。草稿里「开发」一小节的 0.1.0 通过结果是 `<…>` 占位，留给 29 号填。
- **`mods/chat-toc/README.md`** 正常提交：链接根 README（锚点 `#chat-toc`，发布提交之后才有效）与 `CONTEXT.md`、目录结构、本地加载与热重载、`claude plugin test`/validate/tsc、验收工具单元测试、PTY 验收（各场景脚本的命令、cmux 注意事项、运行记录）、证据目录约定、发布清单（逐步勾选）。
- **核对方式**：界面文字全部取自代码常量——状态栏四句（`hooks/lifecycle.ts` `DOCK_STATUS`，26 号）、空状态两句（`hooks/pane.tsx` `EMPTY_TEXT`/`NOT_WRITTEN_TEXT`，17/20 号）、底部的读取失败两句与「有 N 行无法识别，目录可能不完整」（`hooks/register.tsx`，22 号）、被拒说明（`hooks/jump.ts` `REFUSED_TEXT`，23 号）、Agent 侧状态字与时间格式（`hooks/entries.ts`）、过滤行与「布局:…」（`hooks/view.ts`，宿主画成 `1: ●全部` 这样，25 号）、标题「目录」。行为逐条对照规格 §2–§8 与 17–26 号的 Comments；键盘焦点进出（Ctrl+X Tab、Esc、Ctrl+X 方向键调宽）对照 `~/.claude-code-docs/docs/plugins__mods__interface.md`，插件没设 `closeOnEscape`。停靠列数 144/110 是 26 号在两版上实测的宿主阈值，草稿里写明由宿主决定。没有 `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` 也能跑：PTY 驱动的隔离环境从不设它。文档里写的命令都跑过：`claude plugin test mods/chat-toc` 165 通过，验收单元测试 43 通过，两版 `plugin validate` 通过，`tsc` 通过。
- **没能验证、交给 29 号核对的两点**：
  - store 文件名：`--plugin-dir` 实测是 `chat-toc_inline-<hash>.json`（25 号 `remember-*.txt`）；marketplace 安装的 `chat-toc_cc-mods-<hash>.json` 是照 prompt-history 的 `prompt-history_cc-mods-<hash>.json` 推断的。
  - `claude plugin uninstall` 会不会删 store 文件：没查到说明，草稿写成「可能还留在」。
- **依赖 24 号（高亮、跟随、「暂停」）的句子**，24 落地后逐句对照重查（都在草稿的 chat-toc 一节里）：
  1. 操作表「在目录上滚动滚轮」一行的「滚到底后回到跟随最新条目」（24 之后跟随的是高亮那一轮，滚动会暂停跟随）。
  2. 显示规则「三种排版」条的「切换时，选中的条目（没有选择时是正在看的那一轮）留在可见范围内」中括号里的部分（25 号目前用窗口顶部那组作锚，`anchorForSwitch`）。
  3. 显示规则「青色高亮」整条：何为正在看的一轮、对话末尾完整显示时是最后一轮、三种排版的高亮记号（`▌`/`●`/`┃`，25 号已画好、24 号填 `litGroup`）、跳转后高亮停在目标直到再次滚动 transcript、高亮与反色选择互不相干。
  4. 显示规则「跟随与『暂停』」整条：目录滚到高亮、transcript 在末尾时停在最新、手动滚动目录或焦点在目录里时暂停并在底部显示「暂停」、下一次滚动 transcript 时恢复。
  5. 已知限制最后一条里的「跟随与高亮」，以及人工目检那条的「青色高亮与反色选择能否分清」（只是陈述，24 若改了记号再看措辞）。
  6. `mods/chat-toc/README.md`「PTY 验收」里「还没有脚本的 MUST 场景」一句（CT-POS、CT-COEX-001、CT-LIFE-006）和场景表：24 加了脚本后补进表里。
- **依赖 27 号（长会话性能）的句子**：
  1. 已知限制「不承诺在所有机器上有固定的速度；发布时的性能数字只是在一台参考机器上测得的」：27 若给出可公开的结论（例如 20 MB 级会话的首次出目录时间），可在此条或「开发」一小节补一句。
  2. `mods/chat-toc/README.md` 里「还没有脚本的 MUST 场景」中的 CT-PERF-001，以及场景表：27 的性能驱动落地后补命令。
  3. 草稿「会话变化」里「也能跳到很早、从没显示过的轮次」已由 23 号 CT-JUMP-001 验过；27 的长会话跳首尾若有不同结论再改。
