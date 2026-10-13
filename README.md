# cc-mods

Claude Code 的 mod 合集。每个 mod 是独立插件，位于 `mods/<mod 名>/`，互不依赖、不共享代码与数据，可以同时启用；各自有独立的安装与使用说明。

## Mod 一览

| Mod | 版本 | 作用 |
| --- | --- | --- |
| [prompt-history](#prompt-history) | 0.3.0 | 保存成功提交的 prompt，在输入框上方显示可跳转的时间线 |
| [chat-toc](#chat-toc) | 0.1.3 | 在对话右侧停靠当前会话的目录，点击跳回任意一轮 |

新增 mod 时，在上表加一行，并在本文件中新增一个与下方 prompt-history 同级的一节。

---

## prompt-history

在 Claude Code 终端里，把你成功提交的 prompt 按原文保存到本机，并在输入框上方显示一条可浏览、可跳转的时间线。

> 它保存的是完整原文，可能包含凭据。是否开始记录由你在首次提交时决定。

### 环境要求

- macOS 15.x，Apple Silicon（arm64）
- Claude Code `>= 2.1.290`（`claude --version` 查看）
- 交互式终端。Claude Code Desktop（以及 VS Code、移动端）里会用各自的按钮和下拉框画同样的目录，但只在终端里验收过（见[已知限制](#已知限制-1)）；不支持 JetBrains
- 启动时设置 `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`（function hooks 仍是 early access）

不满足时插件不记录任何内容，`/prompt-history status` 会显示原因。

### 安装

两种方式任选其一，不要同时启用：

Marketplace（推荐）：

```sh
claude plugin marketplace add lkangd/cc-mods
claude plugin install prompt-history@cc-mods
```

安装后，`claude plugin list` 应显示 `prompt-history@cc-mods` 为 enabled。

本地加载（开发调试）：

```sh
claude --plugin-dir /path/to/cc-mods/mods/prompt-history
```

两种方式的数据目录不同（`prompt-history-cc-mods` 与 `prompt-history-inline`），互不共享；`/prompt-history status` 的 `database root` 行显示当前使用的路径。

### 快速开始

1. 启动 Claude Code：

   ```sh
   env CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude
   ```

2. 输入 `/prompt-history status`，确认 `support: supported`。
3. 提交第一条 prompt，会弹出「采集同意」对话框：选 `启用`，从这次起记录；选 `继续但不启用`，什么都不保存（该选择会被记住，见[已知限制](#已知限制)）。
4. 输入 `/prompt-history` 展开时间线。按 `Ctrl+X` 再按 `Tab` 进入键盘选择，用 `↑` `↓` 移动，按 `Enter` 跳回对话中的对应位置；也可以直接点击条目。

### 命令

| 命令 | 作用 |
| --- | --- |
| `/prompt-history` | 展开或折叠时间线 |
| `/prompt-history status` | 查看支持状态、同意状态、采集模式、档案位置与大小、待对账项等，不显示 prompt 原文 |
| `/prompt-history enable` / `disable` | 开启或停用当前 Run 的采集；停用不删除已有记录 |
| `/prompt-history clear-run` | 删除当前 Run 的全部记录 |
| `/prompt-history clear-all` | 删除当前项目的全部记录，需在对话框输入 `delete all prompts` |

### 使用要点

- 只记录被 Claude Code 写入对话的提交，斜杠命令不算。相同文本各自保留；多行 prompt 显示为一行，换行处用 `↵` 连接。
- 时间线从旧到新。位于底部时跟随新条目；查看旧历史时，底部显示「↓ N 条新条目」，点击即回到最新。
- 横线是边界标记，例如 `/clear`、分支、采集停用或恢复、Integrity gap。暗色并带 `×` 的条目在对话中已没有对应位置，不能跳转。
- 回退（`/rewind`，或连按两次 Esc）后再提交，时间线从回退点分出新分支。`--resume`、`--continue` 沿用原来的 Run；普通启动与 `/fork` 开始新的 Run。
- 模型运行中提交的 prompt 可能被宿主撤回，会先记为「待对账」。会话空闲后的下一次提交前，由你确认它是否已进入对话。
- 档案无法安全写入时，提交会被拦下，按对话框选择重试，或禁用当前 Run 后继续。

### 数据与隐私

- 完整 prompt 以明文保存在本机 SQLite 中，永久保留，没有配额，同一系统账户或 root 可读取。
- 插件运行时不联网。
- 档案位置见 `/prompt-history status` 的 `database root` 一行。
- `clear-run` 与 `clear-all` 只删除 prompt-history 自己的档案，不删除 transcript、文件系统快照或外部备份中的副本。

### 卸载

1. 在每个启用过采集的项目里执行 `/prompt-history clear-all`，输入 `delete all prompts`；再执行 `/prompt-history status`，确认没有残留。
2. 执行 `claude plugin uninstall prompt-history@cc-mods`（本地加载则去掉 `--plugin-dir` 即可）。默认会删除插件数据目录（含档案）；加 `--keep-data` 则保留。
3. 如有残留，手动删除 `~/.claude/plugins/store/prompt-history_*.json` 和 `~/.claude/plugins/data/.function-hook-locators/prompt-history/`。

### 已知限制

- 只支持上述环境。Intel Mac、Rosetta 下的 x64、Linux、Windows、WSL、macOS 14 及更早版本都不支持。
- 展开后焦点不会自动移入，需要 `Ctrl+X` `Tab` 或点击。`Esc` 不保证折叠时间线。
- 触控板、滚轮，以及 PageUp/PageDown、Home/End 未经真人验收，不作承诺。
- 与其他插件争用输入框上方位置时，不会自动协调。
- 选择「继续但不启用」后，该项目之后不再询问，界面里也无法改回。
- 停用期间的 prompt 不补录。只有图片等附件、没有文字的提交，不保证出现在时间线中。
- 存在 Integrity gap 的时间段不能视为完整历史。

### 开发

- 本地加载（不经 marketplace）：`claude --plugin-dir /path/to/cc-mods/mods/prompt-history`
- `mods/prompt-history/scripts/verify-startup.sh` 是快速门禁（`git config core.hooksPath .githooks` 后，改到本 mod 非 Markdown 文件的提交会自动跑它），`build-artifacts.sh` 重建 helper（需要 Xcode 命令行工具），`release-evidence.sh` 是发布门禁。
- 发布证据：`mods/prompt-history/release/evidence/0.3.0/`。`--plugin-dir` 全量 56/56 通过；Marketplace 52/56 通过，4 个注入类场景未通过，见 `marketplace.md`。更详细的限制与数据说明见 [`mods/prompt-history/README.md`](mods/prompt-history/README.md)。

---

## chat-toc

在 Claude Code 全屏终端里，把当前会话的对话目录停靠在 transcript 右侧：每一轮对话一个条目，点击就跳回那一轮。

> 与 prompt-history 的区别：chat-toc 什么都不保存，只显示当前会话的目录；prompt-history 把 prompt 原文保存成本机档案。两者可以同时启用，prompt-history 在输入框上方，chat-toc 停靠在右侧。

### 环境要求

- Claude Code `>= 2.1.287`（`claude --version` 查看）
- 交互式终端。Claude Code Desktop（以及 VS Code、移动端）里会用各自的按钮和下拉框画同样的目录，但只在终端里验收过（见[已知限制](#已知限制-1)）；不支持 JetBrains
- 全屏布局：运行 `/tui fullscreen` 切换
- 终端足够宽：能不能停靠由 Claude Code 决定。2.1.287 与 2.1.295 实测：自动停靠要 144 列以上，用 `/chat-toc` 打开要 110 列以上
- **不需要** `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS`
- 操作系统不限，但只在 macOS 上实测过（见[已知限制](#已知限制-1)）

不满足时目录不会出现在错误的位置，状态栏会说明原因和办法（见[快速开始](#快速开始-1)）。

### 安装

两种方式任选其一，不要同时启用：

Marketplace（推荐）：

```sh
claude plugin marketplace add lkangd/cc-mods
claude plugin install chat-toc@cc-mods
```

安装后，`claude plugin list` 应显示 `chat-toc@cc-mods` 为 enabled。

本地加载（开发调试）：

```sh
claude --plugin-dir /path/to/cc-mods/mods/chat-toc
```

### 快速开始

1. 在全屏布局里启动 Claude Code。目录自动停靠在右侧，标题是「目录」（2.1.287 没有标题行）。
2. 目录没出现时，看输入框下方的状态栏：

   | 状态栏 | 意思与办法 |
   | --- | --- |
   | `⚠ chat-toc: 目录只在全屏布局里停靠在右侧，运行 /tui fullscreen 切换` | 当前不是全屏布局。运行 `/tui fullscreen` |
   | `⚠ chat-toc: 终端太窄，目录没有停靠；把终端拉宽后会自动出现` | 终端不够宽。拉宽后目录自动停靠，这行说明随之消失 |
   | `⚠ chat-toc: 终端太窄，目录暂时放在输入框上方；把终端拉宽后会停靠到右侧` | 你在窄终端里用 `/chat-toc` 打开了目录，它被放在输入框上方。拉宽后自动停靠 |
   | `⚠ chat-toc: 非全屏布局里目录放在输入框上方；运行 /tui fullscreen 切换后会停靠到右侧` | 你在非全屏布局里用 `/chat-toc` 打开了目录 |

3. 点击任意条目跳回对话里的那一轮。点 ✕ 关掉后，用 `/chat-toc` 随时重新打开，焦点直接进入目录。

### 操作

| 操作 | 作用 |
| --- | --- |
| 点击条目里你的输入（`●` 那一行起） | 跳到这条输入，落在屏幕顶部。斜杠命令和 `!` 命令跳到紧挨着的那一行，并让原来的输入行留在屏上看得见 |
| 点击条目里 Agent 的回复（`├╴` 那一行起） | 跳到这一轮最后一段文字回复；没有文字回复时，跳到这一轮最后画出的内容 |
| 在目录上滚动滚轮 | 按条目滚动目录，目录随之暂停跟随，底栏左边显示「⏸ 暂停跟随」 |
| `Ctrl+X` 再按 `Tab`；或在输入框为空时运行 `/chat-toc` | 让焦点进入目录 |
| `↑` `↓`（焦点在目录里） | 逐个移动选择（你的输入和 Agent 的回复各算一个），选中的那一行反色；跳不过去的也能选 |
| `Enter`（焦点在目录里） | 与点击选中的那一侧相同 |
| `1` `2` `3`，或点击顶部的 `1: 全部` `2: 用户` `3: Agent` | 切换显示：全部 / 只看你的输入 / 只看 Agent 的回复。选中的那个下面有一条高亮色的粗线。选择跨会话记住 |
| `l`，或点击底栏右边的「布局 卡片」按钮 | 按 卡片 → 紧凑 → 时间轴 循环切换排版，按钮上显示当前的那种。选择跨会话记住 |
| `Esc`（焦点在目录里） | 焦点回到输入框，目录不关 |
| `Ctrl+X` 再按 `←` / `→` | 调宽 / 调窄目录（Claude Code 的功能）。你调过的宽度优先 |
| 点击 ✕ | 关闭目录，本会话里不再自动弹出。新开的会话（包括 `/clear`、`/resume` 之后）会再次自动弹出 |
| `/chat-toc` | 目录关着就打开，开着（包括被别的面板挤到后台）就提到前台；两种情况都让焦点进入目录（输入框为空时）。它从不关闭目录 |

热键 `1` `2` `3` `l` 只在焦点在目录里时有效。

### 显示规则

- **条目**：每个条目是一轮对话——你的一次输入，加上 Agent 从这次输入到你下一次输入之间做的事。按对话顺序排列。斜杠命令、`!` 命令各自是一个条目；相同的 prompt 提交几次就有几个条目；Agent 工作时排队提交的 prompt 也单独成条。后台任务通知、`/loop` 触发的工作并入前一个条目。子 agent 内部的内容不出现。
- **时间轨**：条目挂在左边的一条竖线上。你的输入从节点 `●` 开始，Agent 的回复从分支 `├╴` 开始，后面几行和同一天里的组间空行都挨着竖线 `│`。
- **你的输入**：输入的前 2 行，放不下的末尾是 `…`。斜杠命令显示成 `/命令 参数`，`!` 命令显示成 `!命令`；去掉代码块、Markdown 记号和粘贴标记，只有图片时显示「（只有图片）」。折行时逗号、句号不出现在行首，不超过 14 个字符的英文词和文件路径整行换下去。
- **Agent 的回复**：一段暗色文字，先是状态和步数，再是最后一段文字回复，最多 2 行：
  - `N 步 · 回复…`：步数是主 Agent 这一轮调用工具的次数：并行调用逐个计，一个子 agent 算 1 步，思考和中间的文字不算；0 步不写数字，只有回复。
  - `N 步 · 无文字回复`：这一轮最后没有文字回复。
  - `已中断 · N 步`：这一轮被你中断了。
  - `出错 · N 步 · 错误信息`：这一轮以 API 错误结束。单个工具调用失败不算出错。
  - `进行中 · N 步`：最后一轮 Agent 还在工作，分支旁边有一个橙色的 `◐`，步数实时增加。
  - 本地斜杠命令、没有引起 Agent 工作的 `!` 命令只有你的输入。选「Agent」时，这些条目整条隐藏。
- **时间与日期**：时间取自 transcript，换成本机时区。卡片里写在你的输入第一行右端（`HH:MM`），紧凑和时间轴写在竖线左边一栏、每轮第一行。日期变化的地方（包括列表最前面）有一行 `─ 10月9日 ───`，今天写成 `今天 · 10月13日`，不是今年的带年份。读不到时间的那一轮不写时间、也不画日期，不估算。
- **三种排版**：卡片（默认）每侧最多 2 行，时间在右端；紧凑每侧一行，时间在左栏；时间轴每侧最多 2 行，时间在左栏。排版只改画法，不改显示哪些条目。切换时，选中的条目（没有选择时是正在看的那一轮）留在可见范围内。
- **高亮**：标出你在 transcript 里正在看的那一轮（屏幕最上方那一行所在的一轮；对话末尾完整显示时是最后一轮）：节点变成 `◉`、分支变成 `┣╸`、这一轮的竖线变粗成 `┃`，连同时间一起换成高亮色。高亮色和暗色文字都跟随 Claude Code 的主题（`/theme`），高亮与 Claude Code 菜单里选中项同色，换主题后目录立刻跟着变。点击跳转后，高亮停在跳去的那一轮，直到你再次滚动 transcript。`!` 命令那一轮（以及 `--resume` 打开的会话里本地斜杠命令那一轮）在 transcript 里没有可以定位的行：屏幕最上方只露出这种行时，高亮落在下一轮。高亮和 `↑` `↓` 的选择（反色）互不相干，可以落在不同条目上。鼠标停在条目上时，那一侧的文字变成高亮色，鼠标正下方那一行反色。
- **顶部与底栏**：顶部是三个显示选项，下面一条线标出选中的那个，再空一行才是列表。底栏在目录最下面：一条细线，下面左边是目录里的轮数（「12 轮」，不随显示选项变），右边是排版按钮。
- **跟随与暂停**：目录自动滚到高亮的那一轮；transcript 在末尾时，目录停在最新条目。你手动滚动目录，或焦点在目录里时，目录暂停跟随，底栏左边换成「⏸ 暂停跟随」；高亮下一次换到别的一轮时（你把 transcript 滚到另一轮，或点击跳转）恢复跟随。目录被别的面板挤到后台时高亮变了，回到前台就直接跟上。
- **跳不过去的条目**：`--resume`（或会话内 `/resume`）打开的会话里，恢复之前就被 compact 掉的那些轮一出现就挂在空心记号上（你的输入是 `○`、文字变暗，Agent 的回复是 `├┄`）。这些条目照样能选、能点；点了跳不过去时，列表下方出现一行黄色（主题的警告色）、以 ⚠ 开头的提示，先反色闪 3 下：compact 掉的说「这一条在压缩之前，恢复会话后无法跳转」，其他情况说「这一条当前没有显示在对话里，无法跳转」。提示在下一次跳转、移动选择或约 5 秒后消失；点过跳不过去的一侧随后也挂到空心记号上，直到 Claude Code 重新显示那一行。
- **列表下方的说明**：
  - 「有 N 行无法识别，目录可能不完整」：transcript 里有 N 行认不出来（例如 Claude Code 改了格式），目录照常显示其余部分。
  - 「没有权限读本会话的 transcript，目录无法显示」或「读不到本会话的 transcript，目录无法显示」：这时目录不显示任何条目，不拼凑一份不完整的。
- **空目录**：新会话在第一条消息之前显示「本会话还没有对话」；`--fork-session` 或 `--resume` 打开、但还没写出文件的会话显示「本会话还没写进 transcript 文件，提交第一条消息后显示目录」。
- **会话变化**：
  - `/clear`：目录清空，随新会话重建（新会话的第一个条目就是 `/clear`），不画分隔线。
  - compact：之前的条目照常显示。
  - rewind（包括连按两次 Esc）：restore 对话后，被抛弃的那一段（包括 rewind 到的那一条，它的文字回到了输入框）立刻从目录消失，不用等下一次提交。rewind 后没提交就退出、再 resume，那一段会和对话一起回来。
  - `--resume`、`--continue`、会话内 `/resume`、`--fork-session`：目录按那个会话重建，也能跳到很早、从没显示过的轮次。
  - 多个终端各自只显示自己的会话。
  - 在已经运行的会话里启用 chat-toc（`/plugin` 里启用，或 `claude plugin enable` 后 `/reload-plugins`）：不用重启，目录立刻列出已有的对话。万一找不到本会话的 transcript，会显示「提交下一条消息后显示目录」。
- **与其他停靠面板**（例如 `/diff`）：照 Claude Code 的标签规则共存。新打开的面板总在前台；chat-toc 被挤到后台或回到前台时什么都不做，不抢焦点。
- **终端变窄**：已停靠的目录在终端窄到 Claude Code 要把它挪到输入框上方时，chat-toc 会关掉它，并在状态栏显示「终端太窄，目录没有停靠；把终端拉宽后会自动出现」；拉宽后自动停靠。这不算你关闭的。
- 界面文字都是中文。

### 数据与隐私

- 只读当前会话的 transcript 文件（Claude Code 自己写的那份），沿当前分支取行。超过 4 MiB 时，会在本机运行只读的 `sh`（`dd` 加 `head`；Windows 是 Windows PowerShell）按偏移分块读取。
- 不写文件、不建档案、不联网，没有采集同意流程。
- 插件的 store 里只存两个偏好：显示（全部 / 用户 / Agent）和排版。prompt 原文只出现在目录的绘制里，不进 store、日志或错误信息。

### 卸载

1. 执行 `claude plugin uninstall chat-toc@cc-mods`（本地加载则去掉 `--plugin-dir` 即可）。
2. 卸载后，两个偏好可能还留在 `~/.claude/plugins/store/chat-toc_*.json`（marketplace 安装是 `chat-toc_cc-mods-*.json`，本地加载是 `chat-toc_inline-*.json`；设置了 `CLAUDE_CONFIG_DIR` 时在它下面的 `plugins/store/`）。不再需要就手动删除；不删也不含 prompt 内容。

### 已知限制

- Claude Code 低于 `2.1.287` 时，插件不检测、不提示。非全屏布局下不自动出现。
- Claude Code Desktop、VS Code 和移动端里的目录（按钮、排版下拉框、每轮步数的缩略条）只经过 `claude plugin test` 的元素树测试，没有在这些应用里验收；JetBrains 不支持。
- 只在 macOS 上真实验收过。Linux 与 Windows 只验证过读大文件时生成的命令，没在真机上跑；Windows 只用系统自带的 Windows PowerShell 5.1。
- transcript 的文件格式不是公开的。Claude Code 改了格式后，目录可能显示不全，底部会说明有几行无法识别。
- 会话中途启用时，transcript 的位置是按 Claude Code 未公开的目录命名规则推算的；规则变了，目录要等你下一次提交才出现。
- 不保证能跳到 `--resume` 之前就被 compact 掉的行（`--resume` 打开时它们一出现就挂在空心记号上）；跳不过去时列表下方会说明，那一侧挂到空心记号上。
- 三种排版的观感、高亮与反色选择能否分清，由人工目检，不阻止发布。
- 不承诺在所有机器上有固定的速度；发布时的性能数字只是在一台参考机器上测得的（Apple M1 Pro 的 Mac 上，20 MB 级的长会话打开后，Claude Code 显示出最后一轮之后约 0.7 秒内出现目录，滚动和跳转不卡）。
- 用 `/chat-toc` 在不能停靠时打开、放在输入框上方的目录：排版、跟随与高亮都未经验收。

### 开发

- 本地加载（不经 marketplace）：`claude --plugin-dir /path/to/cc-mods/mods/chat-toc`
- 开发、测试、PTY 验收与发布清单见 [`mods/chat-toc/README.md`](mods/chat-toc/README.md)。
- 发布证据：`mods/chat-toc/tests/evidence/0.1.3/`（被测提交 28eefdf）。Claude Code 2.1.287 与 2.1.295 上以 `--plugin-dir` 跑全部 37 个 MUST 场景，两个版本都是 37/37 通过，零失败、零缺失、零跳过；本地目录 marketplace 冒烟两个版本都通过，发布后从 GitHub 的安装级检查结果见 `marketplace.md`。三种排版的观感与颜色能否分清的人工目检尚待签字（不阻止发布）。
