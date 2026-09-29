# Prompt Trail

Prompt Trail 是一个 Claude Code 插件。它把你在终端 composer 里成功提交的每一条 prompt 按原文保存到本机，在输入框上方显示成一条可以浏览、可以跳转的时间线。

## 支持矩阵

只支持下面这一种组合，其他组合一律不承诺：

- macOS 15.x，原生 arm64；
- Claude Code `>=2.1.273`，并在进程环境里设置 `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`（function hooks 仍是 early access）；
- 交互式终端；
- 从可信的本地目录加载：`claude --plugin-dir <本仓库>/mods/prompt-trail`。

启动时，插件会先检查平台、宿主版本、locator、helper 摘要、helper protocol 和系统 SQLite 的能力。任何一项无法证明，插件都会失败关闭，`/prompt-history status` 显示 `unsupported target` 或 `helper unavailable`。这时插件不会联网，不会现场编译，也不会退回到内存中的时间线。

## 使用

- 第一次提交 prompt 时，插件会先询问是否为当前项目启用采集。选「继续但不启用」则什么都不保存。
- `/prompt-history` 展开或折叠时间线；`/prompt-history status` 查看状态。status 不会显示任何 prompt 原文。
- `/prompt-history disable` 停用当前 Run 的采集；`/prompt-history enable` 重新启用。
- `/prompt-history clear-run` 删除当前 Run 的全部记录；`/prompt-history clear-all` 删除当前项目的全部记录。两者都会先列出将要删除的内容，确认后才执行。

## 不支持的平台与 surface

- Linux、Windows、WSL、Intel Mac、Rosetta，以及 macOS 14 及更早的版本；
- Claude Code 低于 `2.1.273`，或者版本无法证明；
- Desktop、VS Code、JetBrains、Mobile 等非终端 surface。

## Marketplace 边界

Prompt Trail 只通过 `--plugin-dir` 加载。它不经 Marketplace 发布，也不处理 Marketplace 的安装、更新、卸载、scope 合并和 `--keep-data`。移除 `--plugin-dir` 之后，插件不会自动清理任何数据（清理步骤见文末）。

## 交互限制

- 展开时间线后，键盘焦点不会自动移进去。要用 `ctrl+x tab` 或鼠标进入。
- Esc 只保证把焦点还给 composer，不保证折叠时间线。
- 焦点离开时间线后不保留选中位置：再次进入（包括 `/reload-plugins` 之后）总是从最新条目开始。
- 不保证触控板和滚轮滚动时间线；方向键和鼠标点击可以到达时间线的首尾。
- 未经真人验收的 PageUp/PageDown/Home/End 不作承诺。
- 其他插件同样占用输入框上方的位置时，Prompt Trail 不会与它们自动协调。AskUserQuestion 对话期间，时间线会让出位置。
- 当前 transcript 里已经没有的条目会显示 `×`，不能跳转。
- 同一个进程里用 `/resume` 回到它先前打开过的 session 时，那个 session 原有的条目显示 `×`，重启后恢复。

## 删除边界

- `clear-run` 和 `clear-all` 只删除 Prompt Trail 自己的档案。Claude Code 的 transcript 与 history、文件系统快照、Time Machine 和其他外部备份里的副本都**不会**被删除。
- 删除不保证 SSD 介质上的数据不可恢复。
- 物理清除没有完成时（例如 WAL 或备份文件删不掉），插件会报告「逻辑删除完成、物理清除未完成」，列出残留，并保持档案不可用，直到清除完成。
- Integrity gap 表示那一段历史无法证明完整。只有删除它所在范围的 `clear-run` 或 `clear-all` 才会移除它。

## 数据位置

以默认的 Claude Code 配置目录 `~/.claude` 为例：

- 档案：`~/.claude/plugins/data/prompt-trail-inline/archives/`。每个项目一个 SQLite 文件，prompt 以明文保存，同一系统账户或 root 可以读取。
- 插件状态（consent、Run 模式、恢复队列，不含 prompt 原文）：`~/.claude/plugins/store/prompt-trail_inline-*.json`。
- 进程 locator：`~/.claude/plugins/data/.function-hook-locators/prompt-trail/`。

## 移除 `--plugin-dir` 之前的数据清理

1. 在每个启用过采集的项目里，用 Prompt Trail 启动一次 Claude Code，运行 `/prompt-history clear-all`，按提示输入确认短语，然后用 `/prompt-history status` 确认档案已清除、没有残留。
2. 退出所有加载了 Prompt Trail 的 Claude Code 进程。
3. 删除上一节列出的三个位置：

   ```sh
   rm -rf ~/.claude/plugins/data/prompt-trail-inline
   rm -f ~/.claude/plugins/store/prompt-trail_inline-*.json
   rm -rf ~/.claude/plugins/data/.function-hook-locators/prompt-trail
   ```

4. 从启动命令里去掉 `--plugin-dir`。

## 发布证据

`scripts/verify-startup.sh` 是快速的开发门禁。`scripts/release-evidence.sh` 是发布门禁：它依次在最低兼容版本和当前发布验收版本上运行全部门禁、100k benchmark、真实 PTY 场景和隐私扫描，再把报告写到 `build/evidence/`。只有零失败、零缺失、零跳过、零泄漏时，报告才判定通过。场景清单见 `release/scenarios.json`。
