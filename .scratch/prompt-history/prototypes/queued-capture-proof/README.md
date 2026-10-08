# Queued Capture Proof · Issue 35

## 状态

**第二阶段原型完成到离线停点；第三阶段公开 API 静态核对完成；使用者选择保留 Q1–Q3，正式修复暂停在宿主关联契约缺口。Issue 35 仍 claimed、未修复。** 正式 hooks/helper/schema/制品未改，未提交或 push。

- 原型测试 **43/43**：保留第一阶段 10 项；新增候选映射、真实文件读取及回放边界测试 33 项。关键行为先 RED 再实现；出队但尚无 user 的 waiting 例是已有行为的补充回归。
- 改后的观察插件在 **2.1.273 / 2.1.283** 静态 validate 通过，仅缺 author 警告。静态通过不证明新探针已跑过真实宿主。
- 第二阶段 **0 次新 PTY 启动、0 次新的宿主模型调用**。已批准的有界真实实验因离线前置不足而跳过，不能称为 PTY PASS。
- 第一阶段真实观察：两个版本均复现撤回误归档及下一提交误开分支；最新一轮各扫描 590 文件、0 泄漏。自动 popAll 的旧触发原因仍未知。

## 本阶段结论

`association.analyze(observation)` 在显式的有限 FIFO 假设下枚举资格→队列项→人类行。两条同文资格，一条进入、一条撤回，缺少 composer→enqueue 顺序时有两个合法身份见证：交换两条资格与队列项的归属，会交换它们的进入/撤回结果。

加入 `captureOrder` 假设后，可以条件化唯一；**但没有获得这个假设的宿主契约或独立身份桥**。输出的 `contractStatus` 始终为 `hypothesis-only`，`safe` 保持 ambiguous；调用者的 `verified: true` 无效。它不修改 `verdict.adjudicate()` 的既有 waiting/ambiguous 边界，更不写 Prompt Entry。

这是有限模型中“缺少约束无法唯一”的见证，**不是实测宿主违反 FIFO**，也不证明所有位置协议都不可能。增加真实样本只能增加观察支持，不能自行变成保序保证。

## 候选契约清单

| 关联条件 | 当前依据／状态 |
| --- | --- |
| prompt.submit 的 next 在排队时即可返回 | 类型与两版本真实观察支持；不是进入证明 |
| turnId、classic prompt_id、render requestId 贯穿提交到进入 | 已观察到共享／变化，不能直接作身份桥 |
| 同一次 hook 的 before/after 可配对 | 新观察器在闭包内分配 epoch + observationId；仅证明观察配对，未真实运行新版探针 |
| composer→enqueue 严格保序且一对一 | 未找到可采用的公开契约；不能由采样发起序推定 |
| 没有未捕获／内部队列来源，起点队列已知为空 | 原型模型的显式假设；真实旧证据没有证明 |
| dequeue→人类行一对一并保序 | 原型模型的显式假设；合并、拆分及内部行不能过滤后假称成立 |
| 文件完整、原始 prefix 未改且处于同一活动路径 | 新 reader 校验物理读取／完整字节 prefix；不证明活动路径或宿主静止 |
| session.append 的实际行 UUID / append→store 顺序 | 当前 2.1.286 bundled 文档有该接口；不是 submit→enqueue 的桥，不能回推 273/283，本轮不新增 286 实验 |

Context7 的 v2.1.278 材料只提供 classic hooks 并行说明，不能推广为 function middleware 的队列顺序契约。新 append 接口的依据是本会话 bundled `plugin-authoring/reference.md` 的 session.append 段及对应 types，不是旧版本的运行证据。

## 公开 seams 与限制

- `association.analyze`：显式 composer 资格、final-ready、完整人类 prefix、新人类行、有序操作及条件化约束 → 分析状态、映射数量、至多两个见证和保护状态。最多 3 条资格、3 条 enqueue、12 条相关记录、128 个搜索分支；超限返回 indeterminate，候选数量只给下界。身份不同即映射不同，不能因结果都 entered 就称唯一。
- `journal_reader.read_journal`：真实文件／前次边界 → 去正文结构、单句柄 fstat 稳定性、完整行位置、原始 prefix 摘要及缺口。坏完整 JSON、换文件、同 inode 改写／截断、旧缺口都不能假称连续；不读取未完成末行作为终局。测试确实经过 parser，不再仅传一个未被读取的 partial-tail 标志。
- `journal_reader.collect_observation`：stdin 观察记录与隔离 config → 去掉正文的观察及 reader 快照。正文先变摘要，不写观察文件；不保留附件内容。
- `replay.replay`：全体观察记录 → 调用配对、读取／契约缺口及观察计数。不靠相邻序号、同文、最大 inode 或最后落盘 observation 补配；不会从 transcript 补资格。**当前是进入枚举前的完整性预检，不是已经实现的真实 FIFO 身份适配器。**

队列模拟会区分 dequeue 与 popAll：已出队但 user 尚未出现者不被后续 popAll 撤销；后来提交也不是旧队列的成员。来源不明、缺最终结果、prefix 改变、冲突身份和无法完成的搜索均不自动确认/丢弃。

## 对旧回放的纠正

旧 `identity-evidence.json` 保留第一阶段历史输出，不改写原始证据。但旧回放的初始 waiting 是将 `users = prefix`、操作为空、`complete = True` **构造出来的输入结果**，不是独立证明的健康等待。

本阶段仍能读取两份旧 run3 临时报告：273 有 78 条观察／74 个 journal 快照；283 有 74 条观察／70 个快照。两者都没有共同 observationId，也没有新 reader 的 prefixDigest/readStable 边界。当前回放均为 indeterminate，记录配对／读取／关联契约缺口，不重新输出“afterQueue waiting”。输出 captures 为空表示没有可配对的调用输入，不表示宿主没有 composer 提交或其资格被撤销；各报告仍保留 9 次 composer after、其中 4 次 queued return 的观察计数。

`position-evidence.json` 是本阶段摘要，包含合成模型见证与旧报告的预检输出，无正文、凭据、真实 UUID 或本机路径。完整旧快照只在会话 scratchpad，不整份复制入仓。

## 运行与验证

不调用模型的测试与旧快照预检：

```sh
python3 -m unittest discover -s .scratch/prompt-history/prototypes/queued-capture-proof -p 'test_*.py' -v
python3 .scratch/prompt-history/prototypes/queued-capture-proof/replay.py <probe-273.json> <probe-283.json>
```

`test-results.txt` 是当前 43 项的实际输出。Python 源码已通过语法检查；runner 的 `--help` 也通过。未运行正式 plugin tests、startup、发布门禁或修复后的 PTY。

`run_probe.py` 已改成每次最多 6 条 composer 输入（为 consent 预留额外一次）、5 分钟硬截止、不自动重试；快速重复输入与部分出队后撤回共用一个隔离会话。不授予宽泛工具权限，模型沿用 release harness 的 haiku。新快照只写新的 0700 临时目录，文件 0600，不覆盖旧证据。结束检查点明确标 observer 未证明排空、非原子宿主快照。

**本阶段没有执行这个新版 runner，以上运行路径尚未经真实 PTY 验证。** 真正运行前仍需确认授权与预算，且需使用 release/requirements.txt 所需环境；CLI 还要求 `--run-authorized-pty`。本轮批准的最多两次启动已因离线停点跳过，不把未用预算转给 rewrite、内部注入、reload 或新版本实验。观察器需由 runner 在隔离 config 安装 `queue_observer_reader.py`，不是可直接接入真实会话的插件。

## 后续停点

仍缺 composer 资格与 enqueue/真实行的独立关联契约。若继续研究当前版本，必须补出可检查的来源、起点、基数和保序依据；如果改研究新 session.append，需要另行对齐宿主版本与实验范围。未经确认不改正式归档协议，不以“样本顺序看起来一致”升级 proof。

## 第三阶段：2.1.286 session.append 静态结论

2026-10-01，使用者要求继续后，仅核对本会话 bundled 的 `plugin-authoring/reference.md` 与 `types/claude-code.d.ts`。Context7 官方 Claude Code 材料未匹配该接口；这不说明本机 API 不存在，也不是版本兼容性或真实 PTY 证明。

| 核对项 | 公开保证与限制 |
| --- | --- |
| 存储行身份与完成 | `SessionAppendInput` 的 uuid 固定；`next(e)` 返回实际存储的 message/uuid。能证明该行保留，未关联原 pending |
| 顺序范围 | 同一 conversation 按 append 发起顺序存储；未保证 submit/enqueue/dequeue 到 append 的对应顺序 |
| 队列与撤回 | queue-operation 不是 conversation row；append 不能独自提供特定资格的撤回 receipt。没有新行不能证明撤回 |
| 来源范围 | origin 固定，但 PromptAttachmentOrigin 把运行中投递的 prompt/notification 列为 engine 来源；不能假设所有 composer 输入都对应单独的 composer-origin user 行 |
| 正文范围 | content 是 API blocks，含行的渲染内容且可被下游改写；缺少将最终 submit.text 与行内容、注入 context、逻辑附件区分的契约。不能拼接全部 text blocks 当 Entry 全文 |
| 读取与恢复 | SessionMessage 仍只有 role/text/toolUses/toolResults 及仅 compact 可用的 handle，没有公开 uuid；load/resume 不触发 append。后续 engine 裁剪、hint 清理、compaction 编辑也不是新 append |
| 写失败 | engine 行不能通过不调用 next 或 deny 拒绝；仅 plugin 自己的 note 可 deny。因此不能把原 pending 预写搬到 append 并声称仍能失败 drop/保留草稿 |

可复核声明位置（仅对应当前 bundled 2.1.286）：

- `reference.md:98–108`：append/store、固定字段、engine 行不可拒绝、顺序边界与 queue-operation 排除。
- `reference.md:125`：插件的 `$.prompt.submit` 等待 idle 后开启自己的 turn，不是 composer 运行中排队行为的契约。
- `types/claude-code.d.ts:7492–7566`：附件名称、文本渲染及 PromptAttachmentOrigin，尤其运行中投递文本的 engine 来源。
- `types/claude-code.d.ts:8239–8326`：PromptSubmitInput/Result，没有共享 append.uuid 的提交身份；queued return 仍非进入证明。
- `types/claude-code.d.ts:9681–9822`：door、输入/消息/来源/结果与存储行身份。
- `types/claude-code.d.ts:10263–10288`：SessionMessage 包装不公开 uuid，handle 不在 messages() 返回中。
- 项目 `.scratch/prompt-history/spec.md:156–170`：资格、最终全文、预写失败、显式对账与活动路径的现有边界；本轮未修改。

**结论：新接口补的是 row→store 身份，不是已证实的 submission→row/withdrawal 桥。** 同文、时间、hook 闭包、append 顺序均不能自行补桥；未找到这条桥不代表所有方案不可能。只凭 append 创建 Entry 将把成员资格从 composer prompt.submit 改到实际存储行，不能自行实施；保留现有资格并用 append 确认，仍需证明两者对应及撤回身份。

推荐先取得宿主贯穿提交、进入与撤回的 receipt，或明确且可检查的来源/基数/保序契约。若选择重新定义为实际存储行采集，需要重新对齐成员资格、最终全文、附件摘要、预写/后置失败和恢复，以及最低宿主版本；这不是现有 Q1–Q3 下已经可落地的修复方案。

本轮无新 PTY、无新的宿主模型调用、无新原型代码/测试，也未重跑测试；43/43 保留为第二阶段结果。未修改正式实现/协议/制品，未升级、提交或 push。2.1.286 真实探针及正式实现需另行批准，不滚用第二阶段跳过的预算。

## 其余公开 API 补查

只读补查同一份 2.1.286 bundled 声明与 reference，未运行宿主。以下行号指向 `types/claude-code.d.ts`，结论只限于已检查的公开契约，不是所有方案都不可能的证明。

| 候选接口 | 静态结果与声明位置 |
| --- | --- |
| wait / turn 生命周期 | 忙时输入无论 wait 手势真假都排队（8265–8274）；turn.start 在 submit/settings hook settled 后有 text/turnId（12379–12402），turn.complete 只有 turn 终局（12285–12368）。这是局部先后，不是提交到队列/行的全局对应 |
| session.receive / command.run | receive 的来源不含 composer，consumed 是入队前消费（10460–10582）；command 的 ref 只标识 command run（1604–1687）。没有 composer 提交到 append 的共享身份 |
| next 上下文 / trace | next 公开 signal/event/origin/trace/budget，没有 submissionId 或 parent dispatch 身份（5983–6069）；trace 是同事件下游各链环的 received/returned/outcome（12224–12283），不是嵌套 append 因果图 |
| signal / turn.abort / timer.cancel | signal 有多种放弃原因（6015–6022）；turn.abort 结束当前运行轮（2694–2707），timer.cancel 只取消定时器（11722–11736）。不能证明特定 queued 提交已撤回；未找到公开队列 item-ID 枚举/取消 receipt |
| drop / prompt.fill | drop 可明确拒绝接纳（8315–8325）；坏插件会放行（3783–3789），所以 throw/超时不等于 fail-closed。fill 可被 dialog/headless 拒绝（3792–3797），drop 不保证草稿自动恢复 |
| 插件重投 | plugin origin 不因 asUser 改成 composer，@file/粘贴图片也不按原 composer 路径展开（8150–8167、8194–8214）；不能 drop 后由插件重投来保持现有来源与输入处理边界 |
| messages / resume / store | messages 有最新 4096 行限制（2515–2547），不暴露行 UUID（10260–10288）；resume 只给会话 ID（10617–10628）。store/state 保存插件自身数据（3116–3155），无与宿主 enqueue/append/撤回原子提交的契约 |

**补查结论**：尚未取得实时成功绑定、精确撤回或持久恢复所需的跨阶段身份桥。成功绑定与撤回必须分别证明；局部调用结果、dispatch 中断和插件自己的账本不能填补宿主终局。不能将“未找到公开契约”扩大为“任何宿主改造或插件方案都不可能”。

## 宿主需求草案

[host-contract.md](host-contract.md) 将现有 spec、Issue 13/15 与 Q1–Q3 转成最小实时能力、可选自动恢复要求及 10 个手算验收场景。它不是宿主已有 API、正式实现计划或已运行测试；只保存在本地，未对外发送。共享身份必须同时解释进入、撤回及最终文本，不能只在 append 加一个 ID 就声称整票已可修复。无法恢复 receipt 时仍可保持 pending 并沿用显式对账，不承诺所有重启自动恢复。
