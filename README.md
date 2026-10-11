# cc-mods

Claude Code 的 mod 合集。每个 mod 是一个独立的插件，位于 `mods/<mod 名>/`，各自有独立的安装与使用说明。

## Mod 一览

| Mod | 版本 | 作用 |
| --- | --- | --- |
| [prompt-history](#prompt-history) | 0.3.0 | 保存成功提交的 prompt，在输入框上方显示可跳转的时间线 |

新增 mod 时，在上表加一行，并在本文件中新增一个与下方 prompt-history 同级的一节。

---

## prompt-history

在 Claude Code 终端里，把你成功提交的 prompt 按原文保存到本机，并在输入框上方显示一条可浏览、可跳转的时间线。

> 它保存的是完整原文，可能包含凭据。是否开始记录由你在首次提交时决定。

### 环境要求

- macOS 15.x，Apple Silicon（arm64）
- Claude Code `>= 2.1.290`（`claude --version` 查看）
- 交互式终端；不支持 Desktop、VS Code、JetBrains、移动端
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
- `mods/prompt-history/scripts/verify-startup.sh` 是快速门禁，`build-artifacts.sh` 重建 helper（需要 Xcode 命令行工具），`release-evidence.sh` 是发布门禁。
- 发布证据：`mods/prompt-history/release/evidence/0.3.0/`。`--plugin-dir` 全量 56/56 通过；Marketplace 52/56 通过，4 个注入类场景未通过，见 `marketplace.md`。更详细的限制与数据说明见 [`mods/prompt-history/README.md`](mods/prompt-history/README.md)。
