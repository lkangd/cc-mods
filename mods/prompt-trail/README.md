# Prompt Trail

Prompt Trail 是一个 Claude Code 插件。它把你在终端 composer 里成功提交的每一条 prompt 按原文保存到本机，在输入框上方显示成一条可以浏览、可以跳转的时间线。

## 支持矩阵

只支持下面这一种组合，其他组合一律不承诺：

- macOS 15.x，原生 arm64；
- Claude Code `>=2.1.290`，并在进程环境里设置 `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`（function hooks 仍是 early access）；
- 交互式终端；
- 从可信的本地目录加载：`claude --plugin-dir <本仓库>/mods/prompt-trail`。

启动时，插件会先检查平台、宿主版本、locator、helper 摘要、helper protocol 和系统 SQLite 的能力。任何一项无法证明，插件都会失败关闭，`/prompt-history status` 显示 `unsupported target` 或 `helper unavailable`。这时插件不会联网，不会现场编译，也不会退回到内存中的时间线。

## 档案健康与制品升级

Issue 53 已于 2026-10-06 resolved：审查修复后的完整非模型 startup 门禁通过，包括 184 项 helper 测试（含 11 项只作用于测试临时目录的系统操作测试）。本节不表示已部署、已发布，也不表示真实 PTY 验收已经通过。

- SQLite schema 仍为 2，helper protocol 仍为 1，插件版本不变；helper 制品和摘要会变化。部署前必须退出所有使用旧制品的 writer（包括采集、生命周期及迁移/隔离/清除等维护调用），再用新制品重新接入。旧 locator 不原地改写，reload 不能替代新的进程接入。helper 无法自动证明旧 writer 均已退出，混版本并发不在保证内。
- helper 的无正文健康记录绑定 Archive generation、健康状态和随机状态 token，是共享损坏的权威；store 只保存显示镜像。已有档案缺少有效记录时为「档案健康状态未知」，须显式完整复检/初始化，不靠普通写入成功推断健康。这是检查尝试，不保证修好；非法记录或发布残留仍被拒绝时继续阻止采集。若决定删除全部项目档案，可另行使用需强确认的 `/prompt-history clear-all`。
- 解除已记录损坏必须在 helper 守卫内核验 generation/token 并完整复检，恢复保留 healthy 回执而非删除记录。普通成功和 `clear-run` 不解除项目共享损坏；隔离/`clear-all` 完成后才退休旧 generation。`integrity-check` 不改原 SQLite/WAL 字节，但发现真实损坏会持久发布健康 metadata；健康诊断不解除损坏，普通 busy/full/read-only/I/O 不发布 damaged。`archive-health-init` 已有回执也完整复检，不解除已有 damaged/token。
- 保证从损坏事实成功持久发布开始。发布期间保留 `.health.partial` 门与 `.health.ready` 暂存链接；健康回执的文件和目录同步完成后才清门。残留一律阻止写入，查询也不能将未完成发布称为健康；隔离续接完整复检后才能清理可信残留，已发布的损坏 token 不因此解除。SQLite、健康记录与 store 之间没有跨资源事务；发布前进程被终止或发布失败，不保证其他进程已经知道损坏。回执持久化后的清门同步是 best-effort，重启若残留回来，只会保守阻止。

## 使用

- 第一次提交 prompt 时，插件会先询问是否为当前项目启用采集。选「继续但不启用」则什么都不保存。
- 只有 Claude Code 真正把这条 prompt 存进对话，它才成为时间线上的一条记录。模型运行中输入的 prompt 会先排进宿主队列，之后可能被撤回，宿主也不说明哪条进入了；所以排队的提交先保持待对账，不算记录。它没结算时，会话还在运行就再提交会被拦下、草稿恢复；会话空闲后的下一次提交先弹出对账，写明它排队之后宿主存储了几条 composer 行。空闲时提交、但提交期间存下的 composer 行不是恰好一条只属于它的，也同样待对账，对话框写明提交期间存了几条。一条都没有时它不可能已进入，对账只提供「未进入 / 新根分支」；有存储行或无法证明时（例如重启后排队计数断了），才另外提供「已进入」。提交时被改写过的 prompt，若重新载入或重启后改写后的文本已经丢失，对账不提供「已进入」，只提供「不归档 / 新根分支」，不会把改写前的文本当作它归档。
- `/prompt-history` 展开或折叠时间线；`/prompt-history status` 查看状态。status 不会显示任何 prompt 原文。
- `/prompt-history disable` 停用当前 Run 的采集；`/prompt-history enable` 重新启用。已有档案健康未知时，`enable` 提供显式“初始化并完整复检”确认，即使当前 Run 已停用也可使用；失败或取消不改变采集模式，不创建 Prompt Entry。
- `/prompt-history clear-run` 删除当前 Run 的全部记录；`/prompt-history clear-all` 删除当前项目的全部记录。两者都会先列出将要删除的内容，确认后才执行。

## 不支持的平台与 surface

- Linux、Windows、WSL、Intel Mac、Rosetta，以及 macOS 14 及更早的版本；
- Claude Code 低于 `2.1.290`，或者版本无法证明；
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

## 删除边界

- `clear-run` 和 `clear-all` 只删除 Prompt Trail 自己的档案。Claude Code 的 transcript 与 history、文件系统快照、Time Machine 和其他外部备份里的副本都**不会**被删除。
- 删除不保证 SSD 介质上的数据不可恢复。
- 物理清除没有完成时（例如 WAL 或备份文件删不掉），插件会报告「逻辑删除完成、物理清除未完成」，列出残留，并保持档案不可用，直到清除完成。
- Integrity gap 表示那一段历史无法证明完整。只有删除它所在范围的 `clear-run` 或 `clear-all` 才会移除它。它按 Run 归属，与 generation 级的共享损坏事实不同；删除某 Run 的 gap 不等于解除共享损坏。

## 数据位置

以默认的 Claude Code 配置目录 `~/.claude` 为例：

- 档案：`~/.claude/plugins/data/prompt-trail-inline/archives/`。每个项目一个 SQLite 文件，prompt 以明文保存，同一系统账户或 root 可以读取。该目录内的 `.sqlite3.health` 只保存项目身份、generation/state/token 与格式版本，不含 prompt；稳定 `.health.lock` 不随 `clear-all` 删除或替换。
- 插件状态（consent、Run 模式、恢复队列、健康显示镜像，不含 prompt 原文）：`~/.claude/plugins/store/prompt-trail_inline-*.json`。
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
