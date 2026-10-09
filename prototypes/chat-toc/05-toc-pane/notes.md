# 05 原型观察记录（进行中，关票时汇入 05 号票的 Answer）

原型 mod：`~/.claude/dev-mods/e6ece91f-32d1-4d89-8cc9-574fb52eb5ad/chat-toc-proto/`（热重载，关票时整体收进本目录并提交到 throwaway 分支）。

## 已与使用者确认

- 三种布局（A 卡片 / B 紧凑 / C 时间轴）都保留，做成使用者可切换的功能，选择跨会话记在 `$.store`。
- 跳转后高亮锁在目标组；跳转引起的重绘稳定（间隔 <300 ms）后、视口第一次变化即解锁，恢复按视口顶部计算。使用者评价「得劲了」。
- 过滤切换即时生效（原型初版漏了重画）。

## 宿主事实（本机 2.1.295 实测）

- 本地斜杠命令（`/chat-toc`、`/clear` 之后的命令等）在 transcript 里记成 `type:system, subtype:local_command` 行（`content` 含 `<command-name>`），不是 user 行；它们在对话链上，必须开组。`/clear` 自身仍是 user 行。
- `ToolGroup` 的 `requestId` 有时是 `collapsed-<完整 uuid>`，有时是 `collapsed-<uuid 前 24 位>000000000000`；按前 24 位匹配可唯一对上（合成 300 轮会话里全部精确或前缀命中）。非折叠时走 `ToolUse`，`requestId` 是 tool_use id。
- 全屏 transcript 绘制是虚拟化的：resume 300 轮后只画最后约 20–25 轮（65–74 个站点）；跳转或滚动到哪里，哪里附近才画。卸载离屏行时**不一定**再报 `onScreen: null`，残留的「在屏」值会把 Current position 钉在旧位置。
- `$.ui.scroll({ requestId })` 能跳到宿主消息列表里任何一行，包括从未画出过的（`drawn:false` 也返回 `{}`）；只有不在列表里的行（resume 前 compact、rewind 残留）才被拒。
- 热重载后宿主只重画当时在屏的行，transcript 读入晚于首批重画，`requestId` 映射必须在每次读入后重做。
- 兜底跳转 `block:'center'`：回显行 `❯ /tui` 留在输出行正上方，可见。
- 置顶 prompt 条与 Current position：去掉「顶部只露 1 行不计」后，直接跳转与逐格滚动的高亮都与屏幕第 1 行所属组一致；早先「跳到 B 高亮 A」是残留在屏值造成的，不是置顶条。

## 由此改动的决定（关票时写入）

- 取消 B 类「事先淡化」：凭「画出过没有」判断不成立（虚拟化 + 热重载）。一律先跳，被拒才淡化并在底部说明；兜底候选依次重试（原型最多 3 次）。
- Current position：只采信「在屏」行里按对话顺序连续、且含最近一次上报的那一段（两行之间夹着任何非在屏的可绘制行即断开）；`ToolUse` 不参与。
- `requestId` → 行：精确 uuid → `collapsed-` 去前缀 → tool_use id → 前 24 位；跳转时用宿主给的 id。
- 开组规则补 `system/local_command` 的 `<command-name>` 行；`!cmd` 与本地命令的兜底改为「往后最近的可绘制行，没有再往前」，用 `center`。

## 性能样本（合成 300 轮、1.5 MB）

- 首次整份读+解析：冷启动 376 ms，之后每次整份重读 9–49 ms。
- Pane 只画可见窗口：每次重画约 7.5 ms（139 次 / 1040 ms，连续滚轮期间）。
- 连续滚轮 180 格：屏上高亮最终与顶行一致。

## 资产

- `gen.py`：合成 transcript（含多工具轮、`/tui` 本地命令、`!cmd`）。
- `wheel.py`、`click.py`、`probe.py`、`pane.py`、`cmd.sh`：cmux 驱动脚本。
- `logs/`：测试会话的原型日志。
- 测试中一次误操作：`/exit` 未生效，重启命令被当作 prompt 提交，触发一次 Haiku 调用（无工具）；合成 transcript 已删除。
