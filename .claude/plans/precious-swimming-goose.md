# Issue 35：排队提交改为显式对账，成员资格以宿主存储行为准

## Context

插件在 `prompt.submit` 的 `next(e)` 返回后就确认采集。可排队的提交在 `next(e)` 返回时只是排进了队列，之后可能被宿主 `popAll` 撤回、根本没进对话。结果档案里多出一条 transcript 里没有的 Prompt Entry，下一条提交还会被误判成 rewind、开出新分支（273/283 均已实测复现）。宿主始终没有提供能把提交关联到进入或撤回的身份（2026-10-06 核对 2.1.290 仍没有），所以使用者改选路线（2026-10-06）：

- **成员资格以实际存储行为准**：只有宿主通过 `session.append` 存下了对应的 composer 行，提交才成为 Prompt Entry。
- **排队一律显式对账**：排队的提交保持 Pending Capture，不自动确认，由使用者对账。
- **最低宿主版本提到 2.1.290**：273/283 的二进制里没有 `session.append`。
- **正文沿用 submit 的最终文本**：存储行只用来证明“已进入”，helper 协议、schema 2、protocol 1 都不变。

这取代了 2026-10-01 Q2 的“后台自动结算、healthy waiting 可继续排队”。Q1（排队不建 Entry、不推进分支）和 Q3（歧义时阻止并显式对账；reload/重启后不凭同文自动确认）保留。

## 授权边界（批准本计划即授予以下各项，其余仍需另行授权）

- 修改正式 hooks、测试、helper C 常量、生成制品、release 常量和文档；把最低宿主版本提到 2.1.290。
- 第 1 步的真实宿主探针：只在 2.1.290 上跑，用隔离的 HOME / CLAUDE_CONFIG_DIR / TMPDIR / 项目；最多启动 1 次宿主，最多 6 条输入，5 分钟硬截止；只观察结构，不记录正文；做隐私扫描。
- 最终运行一次 `verify-startup.sh`，其中 hdiutil/chflags 只作用于测试自己的 TemporaryDirectory；失败时不复跑涉及系统操作的测试。
- **不包括**：修复后的真实 PTY 验收、发布门禁、插件版本号（仍为 0.1.0；0.1.0 的发布证据不再覆盖新的版本下限）、钥匙串、真实 HOME/archive、写 dev-mods、commit、push。

## 第 1 步：先用真实宿主验证前提，这是后续设计的关卡

扩展现有观察插件 `.scratch/prompt-trail/prototypes/queued-capture-proof/queue-probe/hooks/observe.ts`，增加对 `session.append` 的观察：只记录 door、origin.kind、message.type、name、isMeta、有无 agentId、uuid 的哈希，以及与 `prompt.submit` 前后的先后顺序，不记录正文。复用 `run_probe.py` 的隔离与扫描流程。要确认三件事：

1. 空闲时提交：composer 的 `door: 'prompt'` 行，是否在本次 `prompt.submit` 的 `next(e)` 返回**之前**被存储。
2. 排队后正常出队：这一行以什么 door/origin 存储，是 `prompt`/`composer`，还是 `attachment` 的 `queued_command`。
3. 按 ↑ 撤回（popAll）：确认没有对应的存储行。

**第 1 项不成立就停下，与使用者重新对齐**，因为空闲路径的设计依赖它。第 2 项决定下文“composer 存储行”的识别规则，以实测为准写进代码和 spec。

## 第 2 步：最低宿主版本提到 2.1.290

- `hooks/register.tsx:218` 的 `MINIMUM_CLAUDE_VERSION` 和 `src/prompt_trail_helper.c:30` 的 `MINIMUM_CLAUDE_VERSION_PATCH` 改为 290，然后用 `scripts/build-artifacts.sh` 重建制品（helper 的 SHA 会变）。
- 用 2.1.290 bundled 的声明替换 `.claude/types/claude-code.d.ts`（目前是 2.1.273 写的），配套的 mcp/plugins 声明一并更新。
- `scripts/verify-startup.sh`、`release/release_evidence.py` 的固定宿主改为 2.1.290，只保留一个版本，循环去重。`release/scenarios.json` 和 `release/pty_scenarios.py` 中关于版本下限的文字和注入版本相应更新（例如用 2.1.289 测拒绝）。这里只改常量，不跑发布门禁。
- 测试夹具里的支持版本（`tests/startup.test.tsx`、`startup_refusal.test.tsx` 等的 2.1.278、2.1.272）改为 ≥2.1.290 或 <2.1.290 的对应值。`tests/release_verdict.py` 的 VERSIONS 和 `tests/artifact_static.py`、`tests/helper_protocol.py` 里与下限相关的断言同步修改；版本解析器用的样例字符串只要与下限无关就保留。

## 第 3 步：插件采集改动（`hooks/register.tsx`）

**识别 composer 存储行**：新增 `on('session.append', …)`。先 `await next(e)`，拿到实际存储的结果 `{ uuid }`，再判断：没有 agentId（只看主循环），door/origin 符合第 1 步实测的规则。不符合的直接透传，不做任何事；所有分支都返回 `next` 的结果，不改写行内容。

**绑定窗口**：在 `submitCollected` 里，`await next(e)` 之前打开一个只属于本次调用的窗口，返回后关闭。窗口期间存下的 composer 行记进这个窗口。如果同时有多个调用处在 next 阶段，所有窗口都视为歧义。

**确认规则**，替换 `submitCollected` 中 `next(e)` 之后的 `confirmCapture` 前提：
- `e.turnId` 不存在，且窗口里恰好有一行，且没有并发调用：照旧走 confirm → 推进分支 → appendToWindow。确认失败时沿用 `saveReconcile`，并记下 `membership: 'row'`，表示已有存储行证明。
- 其他情况（排队、窗口里 0 行或多行、并发）：不确认，不推进分支，不写进 Timeline 窗口。用 `saveReconcile` 保存一条 `membership: 'unproven'` 的对账记录，其中包含最终文本（只在内存里）和 `rowsSince: 0`。
- 现有的 stop 边界、abort、damage 处理不变。

**行证据计数**：如果当前存在 `membership: 'unproven'` 的对账记录，窗口外每出现一条 composer 存储行，就把 `rowsSince` 加 1。写入 `$.store` 时串行进行，不保存 uuid 和正文。写入失败、模块重载或进程重启后无法证明计数连续时，改记为 `rowsSince: 'unknown'`：`session.start` 时如果发现已有 unproven 记录，就标为 unknown。`ReconcileState` 升到 `version: 2`，新字段都是可选的；`storedReconcile` 继续接受 v1，v1 视为现有行为。

**排队期间再提交**：`submitCollected` 的 `settlePending` 之前，如果存在 unproven 对账记录且 `e.turnId` 存在（会话正忙），不弹对话框，直接 drop 本次提交并 `restoreDraft`，提示“上一条排队提交尚未结算，等当前回合结束后再提交”。会话空闲时，照常进入对账流程。

**对账对话框**（`reconcilePending`）：
- `membership: 'row'`：直接 confirm，不再询问。
- `membership: 'unproven'`：跳过 `transcriptVerdict` 的同文自动判定。`rowsSince === 0` 时只提供“未进入 / 新根分支”；`rowsSince ≥ 1` 或为 `'unknown'` 时提供全部三项，并在说明里如实写出证据（“此后宿主存储了 N 条 composer 行” / “无法证明是否有存储行”）。取消仍然保持未决。
- v1 记录和启动时发现的 pending：行为不变。

## 第 4 步：测试（TDD，逐条 RED→GREEN）

只用公开的测试接口：`composerPrompt` / `$.prompt.submit`（可带 turnId），测试自己挂在最底层的 `prompt.submit`（在 `tests/support.tsx` 的 harness 里加一个选项：在 next 内调用 `$.session.append`，或者不调用以模拟排队），测试里直接调用 `$.session.append` 模拟出队，再加上 `ui.ask` 的作答。不 mock 内部判定。新文件 `tests/queued_capture.test.tsx` 覆盖：

1. 空闲提交，next 内有一条存储行 → 确认，父节点正确（回归）。
2. 排队提交，没有存储行 → 不建 Entry，不推进分支，`capture-confirm` 未被调用。
3. 排队后撤回，下一次空闲提交 → 对话框只有“未进入 / 新根分支”；选“未进入”后 abort，草稿恢复，下一条提交父节点是撤回前的真实 Entry，不开新分支（原票据里的后果）。
4. 排队后出队（窗口外有一行）→ 对话框提供“已进入”；选择后确认，父节点正确。
5. 排队期间、会话忙时再提交 → drop 并恢复草稿，没有第二条 pending。
6. 空闲提交但窗口里 0 行或 2 行 → 转为 unproven。
7. 重载后 `rowsSince` 为 unknown → 提供三项，说明文字如实。
8. 确认失败但已有存储行证明 → 下次对账直接确认，不询问。
9. 非 composer 来源和带 agentId 的行不计数。

既有测试全部保持通过；harness 默认在 next 内 append 一行，让旧测试走空闲确认路径。

## 第 5 步：文档

`.scratch/prompt-trail/spec.md` 修改 Pending Capture、Prompt Entry 成员资格和最低版本的条文（约第 124、158–160 行和版本条目）；同步 `mods/prompt-trail/README.md`、`CONTEXT.md`，在 Issue 35 票据里补实施记录和停点，更新 `map.md`。不动 Issue 53 的已提交内容。

## 验证

- 第 1 步：探针报告，加 0 泄漏扫描。
- 开发中：`npx -y @anthropic-ai/claude-code@2.1.290 plugin test mods/prompt-trail`、`plugin validate`、`tsc -p mods/prompt-trail/tsconfig.json`，以及不含系统 fixture 的 helper 普通子集（可复用 `/private/tmp/issue53-review-no-system.py` 的思路，脚本放进 scratchpad）。
- 收尾：一次 `verify-startup.sh`（单宿主 2.1.290，含完整 helper），如实记录在票据。
- Issue 35 票据里“真实 PTY 复现”这一项要等另行授权的验收，本计划完成后票据仍是 claimed。
