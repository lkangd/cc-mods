# 35: 排队后被撤回的提交不能成为 Prompt Entry

**What to build:** 模型运行中输入的 composer 提交会进入宿主的队列。`prompt.submit` 的 `next(e)` 在排进队列时就返回（宿主类型：「resolves once the prompt entered the session and its turn started, or it was queued behind the running one」），插件随即确认采集。可是排队的提交之后可能被宿主整个撤回（transcript 里的 `queue-operation` 为 `popAll`），从未进入对话。档案里于是多出一条 transcript 里不存在的 Prompt Entry，违反 Issue 13 的「Prompt Entry 必须与会话里的人类 prompt 一一对应」。下一次提交时，插件发现 transcript 缺了这一行，按 rewind 处理，后面的 prompt 开了新分支，被撤回的那条被折叠成「另一分支」。

**Blocked by:** 13「严格匹配人类 composer 提交」、15「对账 Pending Capture」

**Status:** resolved

- [x] 排队的提交（带 `turnId`）在真正进入对话之前不确认为 Prompt Entry；确认与丢弃的依据、时机和失败时的对账，实现前与使用者对齐。
- [x] 排队后正常出队的提交，仍然恰好产生一条 Prompt Entry，父节点正确。
- [x] 排队后被撤回的提交不产生 Prompt Entry，下一条提交不被误判为 rewind，也不开新分支。
- [x] plugin test 覆盖出队与撤回两条路径；真实 PTY 复现下面的步骤。

## Comments

### 2026-09-27 · 从 Issue 22 验收中拆出

PTY（2.1.283，验收项目 `pt21-project`）：使用者提交 `PT-A 只回复 OK`，模型还在运行时立刻再提交一条相同的 `PT-A 只回复 OK`，接着又提交一条两行的 `PT-B`。band 里第二条 PT-A 显示为「另一分支」，transcript 里没有它。使用者没有按 ↑ 或 Esc，第二条也没有被放回输入框。

实机取证（transcript `f588213a`，只看结构）：
- 第一轮的做法相同，却是 `enqueue` → `dequeue` → 出现一行 user，正常。
- 出问题的那一轮：第二条 PT-A `enqueue`（02:32:02.226），0.56 秒后 `popAll`（02:32:02.788，content 长度 11），之后没有对应的 user 行，也没有 `queued_command` attachment；PT-B `enqueue` → `dequeue` → user 行 `9f9fcf61`。
- 插件追踪：第二条 PT-A 排队时的渲染行（`d7d1d5b0`、`fff55afa`）不在 `messages()` 里；Active Branch 的 tip 在它排队后就变了，说明已经确认采集。

待查：什么情况下宿主会 `popAll`，而且撤回的文本不回到输入框。

### 2026-10-01 · 实现前真实宿主探针（尚未修改采集实现）

使用者授权在隔离 HOME / CLAUDE_CONFIG_DIR / TMPDIR / 项目中驱动真实 PTY。额外加载只观察的函数 hook 插件，记录 `prompt.submit` 前后、`turn.start` 前后、`turn.complete` 的消息结构；保留脱敏屏幕及去掉正文的 transcript / archive 摘要。

- 第一轮两个版本均等待 `tool.before` 超时，未覆盖排队路径；改为等屏幕的 `esc to interrupt`，不依赖模型执行命令。失败轮隐私扫描均为 0 泄漏。
- 第二轮 **2.1.273 与 2.1.283 均完成观察**；分别扫描 566 个文件，均为 **0 泄漏**。这不是修复验收 PASS：实现尚未修改。
- 正常排队：`enqueue` 后 `prompt.submit` 已返回 text，`$.session.messages()` 尚无对应新的人类行；archive 已误建该 Prompt Entry。之后 `dequeue` → user 行，出队产生新的 `turn.start`，不是重走该条 `prompt.submit`。
- 两条同文提交后再提交多行第三条：第二条同文和第三条都排队，依次出队进入人类行。两条排队提交携带同一个 `turnId`，它等于提交时正在运行的第一条的 turn；不是各自的提交身份。
- 手动撤回：运行中提交一条排队 prompt，按 ↑；日志出现 `enqueue` → `popAll`，草稿回到 composer。清空草稿后等运行结束，transcript 始终没有该人类行，但 archive 中仍保留错误的 Prompt Entry。
- 原票面「不按 ↑ / Esc 就出现 popAll 且未返回草稿」**本轮未复现**，原因仍未知。已观察的手动路径不能证明该触发原因；只能证明同样的撤回结果使当前实现误归档。
- 队列 JSONL 结构：`enqueue` / `popAll` 有 `type, operation, sessionId, timestamp, content`；`dequeue` 无 content；均无独立提交 ID / uuid / turnId。`enqueue` 写入时间早于对应 `prompt.submit` hook 被观察到的时间。不能单靠文本、时间或 turnId 推断唯一关联。
- `$.session.messages()` 行没有 uuid / turnId / 队列状态；只有 role / text / toolUses（有时 toolResults）。API 形式可能合并多个文本块，不能将 API 数组项当作独立 Prompt Entry。

本会话临时证据（会随 scratchpad 清理）：`/private/tmp/claude-501/-Users-liangkangda-Fe-project-cc-mods/4dae065f-35c8-4563-92c5-9f7bd10a703c/queue-probe-run2-2.1.273.json` 与 `queue-probe-run2-2.1.283.json`，同名 `.txt` 为脱敏屏幕。以下 Q1–Q3 已与使用者对齐。

### 2026-10-01 · Q1–Q3 对齐与原型范围

使用者回答「都按推荐」：

- **Q1 确认/丢弃**：排队后保持 Pending Capture，不创建 Prompt Entry、不推进 Active Branch；唯一对应的新增人类行才能确认，唯一对应的撤回证据才能丢弃。重复文本、暂时缺行、轮次结束本身不算 proof。
- **Q2 时机**：后台自动结算，下一次 composer 提交前兜底；正常 waiting 不阻止继续排队。未确认条目不是可跳转 Entry。
- **Q3 故障/歧义**：保留 pending，阻止该 Run 后续采集，沿用「已进入 / 未进入 / 新根分支」显式对账；取消保持未决。reload/重启不能凭旧同文消息自动确认。

随后使用者批准先做关联原型与判据验证：补齐非正文身份探针，测试唯一对应判据；暂不修改正式 hooks/helper/schema/制品。若宿主无法提供可证明的关联，记录缺口并停下重新对齐；若成立，再交正式实现计划。

### 2026-10-01 · 身份探针与技术停点（未修复）

第三轮在 2.1.273 / 2.1.283 额外观察了 classic.UserPromptSubmit、classic.SessionStart 和 UserMessage 渲染，并在每个样本读完整 JSONL 行、文件身份及人类行的 uuid / promptId / source。两版本分别扫描 **590 文件，0 泄漏**。

- `prompt.submit` 的实际输入/结果确实无自己的提交 ID（输入 text/wait/origin，运行中多 turnId；结果 text/origin）。
- classic.UserPromptSubmit 在排队时已有 `prompt_id`，但它等于正在运行的 prompt 的 ID。真正出队人类行的 promptId 是另一个新 ID；两条排队 prompt 也可共用这个旧 classic prompt_id。因此不能用该字段桥接 Pending Capture 与出队。
- UserMessage 的 requestId 在排队预览、队列重画、真正人类行之间发生变化；非 placeholder 的预览同样不能作为进入证明。
- ↑ 撤回后再提交，在两个版本都观察到 archive 仍保留撤回的错误 Entry，而下一条进入新的 branch，父节点回到撤回前的真实 Entry。原票的误判 rewind 后果已实测复现。

保留可复跑的探针、无正文/真实 UUID/本机路径的身份摘要及判据原型：[queued-capture-proof](../prototypes/queued-capture-proof/README.md)。原型测试 **10/10**，关键保护规则逐条 RED→GREEN 后通过，另补重复资格和忽略未完成末行的回归；两个版本的观察插件 validate 通过（仅缺 author 警告）。真实快照各 4 条 queued composer 资格回放，初始均 waiting，观察结果后因无绑定均 ambiguous。

**限制**：原型仅实现未绑定时的 waiting/ambiguous 安全边界；没有实现 FIFO 身份关联枚举、entered/withdrawn 自动路径或正式后台结算。10 项测试及真实观察通过不是 Issue 35 修复 PASS。没有稳定 ID 也不等于证明任何保序位置协议都不可能；本轮尚未验证出可安全采用的关联契约。

按批准的停点，暂不修改正式 hooks/helper/schema/制品；也未继续部分出队后撤回、连续快速输入、下游改写、reload/重启的真实 PTY 实验。正式 plugin tests、startup 门禁、完整发布门禁均未运行。

**下一项待对齐**：继续验证并明确限定完整 FIFO/prefix 的位置关联契约，还是要求宿主提供贯穿提交、进入及撤回的稳定身份/事件；未经确认，不把 hook 先后顺序或同文匹配升级为 proof。票据保持 claimed，不标 resolved。

### 2026-10-01 · 第二阶段：条件化位置关联与离线停点

使用者要求继续，并批准第二阶段原型计划：验证受限 FIFO/完整 prefix 的位置契约，不改正式协议；仅在离线前提仍可继续时，最多两个隔离宿主启动、每次最多 6 条输入、5 分钟硬截止。本轮实际 **0 次新 PTY、0 次新的宿主模型调用**，没有将未用预算转给别的实验。

- 新增 `association.analyze` 的有界枚举（最多 3 资格 / 3 enqueue / 12 相关记录 / 128 搜索分支）。两条同文资格、一条进入一条撤回时，在缺少 composer→enqueue 顺序约束的模型中有两个不同归属见证；声明 captureOrder 后条件化唯一，保护状态仍 ambiguous。`verified: true` 不解锁确认。这个结果不是实测宿主违反 FIFO，也不是所有位置协议都不可行的证明。
- 更新观察器：同一 prompt.submit 的 before/after/error 共用闭包内的 epoch + observationId；它不是宿主身份桥。sequence 只叫采样发起序，不当成完成/落盘/宿主线性化序；读取/写入失败不被默默当作成功。改后的插件在两个固定版本静态 validate 通过，仅 author 警告；新版采样尚未真实运行。
- 提取并测试真实 journal reader：单句柄前后 fstat、完整行、原始 prefix 校验、坏 JSON/换文件/同 inode 改写及截断/旧缺口；未完成末行不作终局，附件内容不进入摘要。物理读取完整不等于活动路径或队列来源已被证明。
- 当前 replay 全局预检调用配对与读取边界，不用最后落盘记录当终局，不靠同文/相邻序号补配。它还不是实际 FIFO 身份适配器；没有独立关联契约时不将条件化结果用于自动结算。
- 旧 run3 报告仍在：273 有 78 条观察、74 个 journal 快照；283 有 74 条观察、70 个快照。均缺共同 observationId 与 prefixDigest/readStable，预检为 indeterminate。观察计数仍各有 9 次 composer after、其中 4 次 queued return；没有把未能配对解释成“没有 composer 提交”。
- **纠正旧证据解释**：第一阶段回放的初始 waiting 是构造 users=prefix、operations 空、complete=True 得到的判据输出，不是独立证实的健康等待；旧 partial-tail 测试也未经过 parser。本阶段真实 bytes 测试覆盖此边界。原始身份限制、撤回误归档及误开分支的观察不因此作废。

最终原型 **43/43**；Python 语法检查与 runner --help 通过。新增 33 项中，关键行为先 RED 再实现；出队尚无 user 的 waiting 例是既有行为的补充回归。runner 已改为有界场景、独立临时输出、不覆盖旧证据，但新版真实 PTY 路径未执行，不能称验收通过。

留存 [原型说明与契约清单](../prototypes/queued-capture-proof/README.md)、`position-evidence.json` 的合成见证及旧报告预检摘要、实际测试输出；摘要不含正文/凭据/真实 UUID/本机路径。`identity-evidence.json` 保留第一阶段历史记录，解释以本段限定为准。

**停点**：仅有条件化唯一，尚未取得 composer→enqueue→人类行的可检查宿主契约；离线证据也不能进入可靠关联，因此没有继续模型实验。当前 2.1.286 bundled 的 session.append 是未来线索，仅保证 append→store 并暴露行 UUID，不能回推 273/283 或自行填上提交桥。下一阶段需要另行对齐是否研究新接口及宿主版本；本轮仍不改正式 hooks/helper/schema/制品，不跑正式 plugin/startup/发布门禁，不升级、不提交、不 push，票据保持 claimed。

### 2026-10-01 · 第三阶段：session.append 公开契约静态核对

使用者再次要求继续；本轮仅核对当前 2.1.286 bundled 的公开声明与参考，不启动新宿主、不调用宿主模型、不改采集实现。Context7 官方 Claude Code 文档查询未匹配 session.append，以下依据是本会话 bundled 材料，不是外部文档或真实运行结果。

- 已有保证：每个新追加并保留的 conversation row 在存储前触发 append；uuid、door、origin、agentId 及消息类型/role/isMeta 等固定；next 返回实际存储 message 与 uuid。存储顺序是同一 conversation 的 append 发起顺序。queue-operation 不是 conversation row，load/resume 与后续 engine 编辑也不是新 append。
- 仍缺桥：prompt.submit 输入/结果没有与 append.uuid 共享的提交身份；公开材料未给出每次 composer 资格与队列项、实际行的一对一/保序对应，也未提供本条资格的撤回 receipt。append 顺序不能替代 submit→enqueue→row 顺序；不据此断言任何方案都不可能。
- 来源与正文不能直接替换：PromptAttachmentOrigin 把运行中投递的 prompt/notification 列为 engine 来源；附件含 queued_command 等名称，说明不能假设每次 composer 提交都成为单独的 composer-origin user 行。append.content 是行的 API blocks，可含注入/附件并被下游改写；没有证明它等于本次 prompt.submit 的最终 text。现有 SessionMessage 包装仍不暴露 uuid；稳定行 ID 不等于所有读取 API 都给出该字段。
- 失败边界不同：engine 自己追加的行不能通过 append hook 拒绝。把持久预写移到 append，不能保持“预写失败 drop 本次提交并保留草稿”；只凭 append 来源创建 Entry 也会改变现有 prompt.submit-only 资格规则。本轮未作这些产品/协议变更。

[原型说明](../prototypes/queued-capture-proof/README.md) 记录了具体声明位置及缺口。建议下一步取得可贯穿提交、进入及撤回的宿主 receipt/顺序契约；若改选仅按实际存储行采集，需重新对齐资格、全文、附件与失败恢复边界及最低宿主版本，不能称为保持 Q1–Q3 不变的实现。2.1.286 真实探针需要新授权，第二阶段未用预算不滚用。

本轮只更新本地说明；43/43 是上一阶段原型结果，没有新增或重跑测试，没有新 PTY/宿主模型调用。Issue 35 仍 claimed、未修复；正式 hooks/helper/schema/制品未改，无新提交或 push。

### 2026-10-01 · 宿主关联契约需求草案

使用者再次要求继续；整理 [host-contract.md](../prototypes/queued-capture-proof/host-contract.md)，将现有资格、最终全文、预写失败与 Q1–Q3 转成可核对的能力要求，不修改这些规则。最小实时需求包括副作用前可持久绑定的非正文提交身份、贯穿队列/改写的对应、真正进入 receipt、精确撤回成员、可区分的终局和最终文本边界。自动恢复另需同身份可验证的状态/重放与缺口；宿主不能恢复时保留 pending 走显式对账，不要求所有重启都自动恢复。

附 10 个手算验收场景，覆盖同文一进一撤、已出队项不被 popAll 撤销、撤回后的新资格、非 composer 插入、receipt 早于 final-ready、改写/context 隔离、预写失败、后置持久故障、恢复缺口和冲突终局。没有在未确认 seam 写测试，不把这些样例算作测试通过。

这是本地需求草案，不是宿主已提供的接口、批准的协议设计或已向维护者提交的请求。只增加说明；不调用宿主模型、不改正式实现、不升级、提交或 push。

补查结果已回填[原型说明](../prototypes/queued-capture-proof/README.md)：2.1.286 的 turn 生命周期只有局部先后/turnId；receive/command 的接纳结果不是 composer receipt；next.trace 仅列同事件下游链环，不是跨事件因果图；signal/turn.abort/timer.cancel 不证明特定排队项撤回。插件重投即使 asUser 也仍为 plugin 来源，不能保留原 composer 输入处理。messages/resume/store 不提供宿主终局账本或与队列原子提交的保证。补查没有取得实时进入、撤回或恢复的身份桥，不扩大为任何方案都不可能的断言。

另确认失败边界：宿主公开契约明确坏插件放行，throw/超时不能代替预写失败时返回 drop；drop 本身不保证草稿恢复，prompt.fill 仍可拒绝。后续方案须继续分别处理接纳拒绝、草稿恢复和 Integrity gap，不能借新接口宣称失败关闭已经成立。无新原型测试或宿主实验，Issue 35 仍 claimed、未修复。

### 2026-10-01 · 路线选择：保留 Q1–Q3，暂停正式修复

使用者在三条路线中选择「保留 Q1–Q3（推荐）」：不改为排队显式对账优先，不把成员资格改到实际存储行。保持后台自动结算、健康 waiting 可继续排队及歧义/写失败显式对账的既有承诺。

**当前阻塞**：尚无已取得、可检查的宿主契约把 composer 资格唯一连接到实际进入和撤回；公开 API 静态研究到此结束，正式修复暂停，票据保持 claimed、未修复。解除阻塞需要新的宿主身份/receipt 或独立可验证的对应契约，再提出正式实现计划；重复静态搜索或增加样本不视为解除阻塞。

[宿主需求草案](../prototypes/queued-capture-proof/host-contract.md) 仅保存在本地，不自动对外发送。这个选择不授权新宿主/模型实验、正式代码修改、版本升级、commit 或 push；第二阶段未用预算不滚用。

### 2026-10-06 · 2.1.290 静态核对与路线变更

只读核对本机当前、也是 npm 最新的 2.1.290 bundled 声明：`prompt.submit` 输入/结果仍无提交身份，`next(e)` 仍在进入或排队时返回；`session.append` 仍给出存储行 uuid/origin/door，但提交端没有共享的 uuid；没有出队、撤回或 receipt 事件。2.1.286 声明已被临时目录清理，没有做全文 diff，只按上次结论依据的接口和队列/撤回/receipt/uuid 关键词定向核对。宿主契约缺口仍在。

使用者随后改选路线：**排队显式对账优先，并把成员资格改到实际存储行**。这取代 2026-10-01「保留 Q1–Q3」的选择，Q1–Q3 中依赖提交→队列→行唯一关联的后台自动结算承诺不再作为目标。该选择本身不授权正式代码、宿主/模型实验、最低宿主版本变更、commit 或 push；先提交实现计划，资格、全文、附件、失败恢复边界与最低宿主版本须在计划中重新对齐。

### 2026-10-06 · 新路线实施计划批准

使用者对齐三项：最低宿主版本提到 2.1.290（273/283 二进制无 `session.append`）；排队提交一律显式对账；Entry 正文沿用 submit 最终文本，存储行只证明进入，helper 协议/schema 不变。随后批准计划 `.claude/plans/precious-swimming-goose.md`。

授权：正式 hooks/测试/helper 版本常量/生成制品/release 常量/文档修改；先跑一次 2.1.290 隔离真实宿主探针（最多 1 次启动、6 条输入、5 分钟，只记结构、隐私扫描），其第 1 项（空闲提交的 composer 行在 `next(e)` 返回前存储）不成立即停下重新对齐；收尾一次 `verify-startup.sh`（hdiutil/chflags 仅测试 TemporaryDirectory，失败不复跑系统操作测试）。不含修复后真实 PTY 验收、发布门禁、插件版本号变更（保持 0.1.0）、钥匙串、真实 HOME/archive、dev-mods、commit、push。

开始第 1 步前发现探针 runner 经 `keychain_token()` 读取 release evidence 专用钥匙串条目，与计划“不含钥匙串”冲突，先停下询问。使用者选择「授权这一次探针」：只读该专用条目、只用于这一次 2.1.290 隔离探针，token 作为隐私扫描 secret；不扩展到其他用途。

### 2026-10-06 · 第 1 步：2.1.290 session.append 探针（前提成立）

新增只记结构的观察器 `prototypes/queued-capture-proof/append-probe/` 与 runner `run_append_probe.py`（旧探针与旧证据未改）。在会话 scratchpad 建 venv，按 release/requirements.txt 哈希安装 pyte/wcwidth。授权的唯一一次运行：1 次宿主启动，计 5/6 条输入（含 consent），exit 0，`idle`/`dequeue`/`withdraw` 三段都到达；隐私扫描 591 个文件、0 泄漏（argv 采样数为 0，没有据此宣称 argv 无泄漏）。摘要见 `append-evidence.json`，行 uuid 以 row-N 别名表示，无正文和本机路径。

- 空闲提交：composer 行 `door: prompt`、`origin: composer`、`type: user`、无 agentId、非 isMeta，在本次 `prompt.submit` 的 `next(e)` 返回前存储（序号 2，submit.after 为 17）；同一窗口内其余行都是 engine 来源的 attachment。
- 排队提交（`turnId` 存在）：`next(e)` 返回时窗口内没有任何存储行；运行中的回合结束后，在所有提交调用之外存下同样形状的 composer 行（不是 `queued_command` attachment）。
- ↑ 撤回：`enqueue` → `popAll`，之后没有对应存储行。

这是单次观察，证明计划的前提在这一次运行里成立，不是修复验收；按计划继续第 2 步。composer 存储行识别规则定为上述五个条件。

### 2026-10-06 · 第 2–5 步：实现与统一门禁（PTY 验收待授权，仍 claimed）

**版本下限**：插件 `MINIMUM_CLAUDE_VERSION` 与 helper `MINIMUM_CLAUDE_VERSION_PATCH` 改为 2.1.290，制品经 build-artifacts.sh 重建（helper SHA 变化；schema 2 / protocol 1 / 插件 0.1.0 不变）。`.claude/types` 换成 2.1.290 bundled 声明；随之修正测试夹具的 API 漂移（`process.run` 新增截断标志、`FsEntry`、`ui.open` 的 `isPlaced`、UserMessage 的 `isExpanded`、`PromptSubmitAttachment`），hooks 本身无类型变化。夹具支持版本改为 2.1.290，拒绝用例改为 2.1.289。插件侧“低于下限被拒绝”先 RED 再 GREEN；helper 侧常量与测试同时修改，未单独观察 RED。`verify-startup.sh`、release_evidence.py 的固定宿主改为单一 2.1.290，`BELOW_MINIMUM` 改为 2.1.289；没有运行发布门禁或 PTY 场景。tests/release_verdict.py 的版本只是合成判定单元的标签，与下限无关，保留两版本，未按计划同步修改。

**门禁运行环境**：2.1.290 的 `plugin test` 在使用者真实 config 下拒绝运行（提示 rollout 开关被之前的会话存成关闭）；用空的临时 config 目录运行正常。`verify-startup.sh` 因此让宿主命令使用 mktemp 的临时 config 目录。真实 config 未改动。

**采集**（hooks/register.tsx）：新增 `session.append{door=prompt}` hook，识别 composer 行（origin composer、type user、非 isMeta、无 agentId），在调用 `next` 前计数。依据是声明里行 uuid 固定、“a hook can keep a table by row before calling next”，且 engine 追加的行不能被 hook 拒绝。空闲提交只有在 `next` 内恰好一行、无并发窗口时才确认；确认失败的记录带 `membership: 'row'`，下次直接补确认。其余情况（排队、0 行或多行、并发）保存 `version: 2`、`membership: 'unproven'`、`rowsSince: 0` 的对账记录，不建 Entry、不推进分支。窗口外的 composer 行累加 `rowsSince` 并串行写入 store，写失败或模块重新载入记录时改为 `unknown`。会话忙时有 unproven 记录，新提交被 drop 并恢复草稿；空闲时进入对账，`rowsSince === 0` 只提供“未进入 / 新根分支”。删除了 `transcriptVerdict` 的同文自动确认/丢弃。

**测试**：2.1.290 的测试工具链在 `session.append` 链底部没有实现，测试 hook 也不能替它作答，所以 harness 的 `storeComposerRow` 在所有 hook 看过这一行后，吞掉工具链的 “no implementation for session.append” 拒绝（注释说明）。`support.tsx` 导出包装过的 `test` 以取得 engine `$`，各测试文件改从 `./support` 导入 `test`；harness 规则：带 `turnId` 的提交在 `next` 内不存行。新文件 `tests/queued_capture.test.tsx` 8 项先全部 RED（另有一项与既有用例重复，已并入既有用例），实现后 GREEN。既有 reconcile_pending 中依赖同文判定的场景按新规则改写：同文“已进入”改为存储行证明后补确认，同文“未进入”改为不再自动丢弃，“歧义→已进入”改为重启后发现的 pending 提供三项；“未进入/新根分支/取消”改用没有存储行证明的 pending 触发对话框。

**统一门禁**：授权的唯一一轮 `verify-startup.sh` exit 0：制品一致；2.1.290 validate 通过、plugin test 488/488；TypeScript 5.9.3 通过；artifact_static 9、bridge_protocol 32、helper_protocol 184（含 hdiutil/chflags 测试，只作用于测试 TemporaryDirectory）、project_root 5、release_verdict 28 全部 OK；两个协议探针通过。之后 `git diff --check` 通过。日志：`/private/tmp/claude-501/-Users-liangkangda-Fe-project-cc-mods/1900222a-ac03-4c17-b3c2-6b33b35fc2db/scratchpad/startup-issue35.log`（会话临时目录，可能被清理）。

**尚未完成**：票据最后一项“真实 PTY 复现下面的步骤”未运行，需另行授权；修复后版本没有真实宿主验收、发布门禁、版本号变更、commit 或 push。0.1.0 的发布证据不覆盖新的版本下限。票据保持 claimed。

### 2026-10-06 · 修复后真实 PTY 验收（第 4 轮通过，resolved）

使用者授权修复后 PTY 验收，路线选「隔离驱动 + 读钥匙串」：2.1.290，隔离 HOME / CLAUDE_CONFIG_DIR / TMPDIR / 项目，只加载正式插件；读 release evidence 专用钥匙串条目登录，并作为隐私扫描 secret；每轮 1 次宿主启动、最多 8 条 composer 提交（对话框选择属场景步骤，不计）、10 分钟硬截止，失败不重跑。runner：[run_acceptance.py](../prototypes/queued-capture-proof/run_acceptance.py)。场景：A（长回合，同意采集）→ 运行中排队 QB → ↑ 撤回 → 空闲提交 N1，对账只给「未进入 / 新根分支」且写明 0 条 composer 行 → 选未进入、草稿恢复后重发，N1 父节点为 A、同分支 → N1 运行中排队同文 N1，出队 → 空闲提交 N2，对账给三项且写明 1 条 → 选已进入，同文 N1 归档一次、父节点为 N1、同分支。

- 第 1 轮：第 2 步失败，原因是 runner 标签比较错误（标签函数返回 `ACC-QB`，却和 `QB` 比较）。2 条提交，扫描 12 个文件，0 泄漏。不构成插件结论。修正后，使用者授权重跑一轮。
- 第 2 轮：仍在第 2 步失败，失败时 pending 为空。原因仍是 runner：它在看到 `enqueue` 后立刻读 pending，但本票据 2026-10-01 已记录宿主先写 `enqueue`，`prompt.submit` 才到达 hooks，所以与插件预写有竞争。2 条提交，扫描 12 个文件，0 泄漏。不构成插件结论。runner 已改为最多等 15 秒等预写出现；复查时还把“已进入”判据收紧为非 meta 的 user 行，避免 transcript 中其他带正文的行提前满足条件。第 3 轮需另行授权。

前两轮共启动宿主 2 次，进行了 A（含同意）与 QB 的提交，没有走到对账；各轮临时报告均已删除。各轮报告只保留结构摘要。
- 第 3 轮（使用者授权）：第 2 步全部通过：QB 预写为 Pending Capture，↑ 撤回后 transcript 里没有它的人类行，归档里只有 A。第 3 步因等待字符串超时失败：runner 等的是对话框标题“未决 Pending Capture”，但宿主把标题截成了“☐ 未决 Pending C”。超时时的脱敏屏幕显示对话框其实已经出现，内容符合预期：写明“此后宿主存储了 0 条 composer 行”，选项只有「未进入 / 新根分支」，另有宿主自带的 Type something / Chat about this。这只是一次屏幕观察，不算验收通过。3 条提交，扫描 554 个文件，0 泄漏。runner 已改为等待正文“有一条未决的 Pending Capture”。第 4 轮需另行授权。
- 第 4 轮（使用者授权）：**通过**，17/17 项检查。按 ↑ 撤回的 QB 不进档案；对账框只给「未进入 / 新根分支」，并写明 0 条 composer 行。选未进入后草稿恢复、重发，N1 的父节点为 A，且在同一分支上（没有 rewind，也没有开新分支）。在 N1 运行中排队的同文 N1 出队后，确认前仍是 Pending Capture，对账框给出三项并写明 1 条；选已进入后它只归档一次，父节点为 N1，同分支，不留 pending。用了 6 条 composer 提交和 3 次对话框选择，扫描 554 个文件，0 泄漏。结构摘要见 [acceptance-evidence.json](../prototypes/queued-capture-proof/acceptance-evidence.json)，不含正文、路径和屏幕。

验收没有复现原票据第三步（两行的 PT-B），出队与撤回两条路径已分别覆盖。原票据的同文重复提交，在第 4 轮出队路径里复现了。四轮共启动宿主 4 次，每轮都读取了一次专用钥匙串条目。全部验收项已勾选，状态改为 resolved。未运行发布门禁，插件版本仍为 0.1.0，未提交，未 push。

### 2026-10-06 · 代码审查（单轮）

`/code-review` 审查了 mods/prompt-trail 下的改动，以计划和本票据作为 spec，共 12 项发现，结果见 `.code-review/runs/20261006-124446/round-1/`。

修复了 7 项，凡是行为上的修复都先 RED 再 GREEN：
- 关闭提交窗口与记录 pending 放在同一步完成；排队提交的 `rowsSince` 从窗口内的行起算。这样，记录 pending 之前出队的行不会漏计（合并了 2 项）。
- 一条排队提交在排入期间、还没记成 pending 时，若再有一条排队提交进来，也会被拦下并恢复草稿。
- 不再把 `/resume` 后另一个 Run 的行计给本 Run 的 pending：之前会把旧记录写到另一个 Run 的键下。
- verify-startup 的 trap 改为在创建第二个临时文件之前安装。
- README 写明对账选项取决于存储行数。
- 2.1.290 的测试工具链已经提供 `$.classic`，删掉了各测试里为 2.1.273 留的守卫和过时注释。

转入 backlog 4 项：
- 重启后选「已进入」时，归档的是预写时的正文（这是旧行为，排队后显式对账让它更常出现）；
- 先计数、后存储，受测试工具链限制（合并了 2 项）；
- 测试夹具重复。

驳回 1 项：给 `storeComposerRow` 显式传 engine。原因是 hook 里的 `$` 只能追加 door 为 note 的行，伪造不了 composer 行。

插件测试 491/491，tsc 与 validate 通过。第 4 轮 PTY 验收是在这些修复之前跑的。修复之后没有重跑 PTY，也没有重跑 verify-startup。

### 2026-10-06 · 审查修复后的门禁与 PTY 复验（使用者授权）

- `verify-startup.sh` 一次 exit 0。制品重建后无变化，2.1.290 validate 通过，plugin tests 491/491，TypeScript 5.9.3 检查通过。Python 测试：artifact_static 9、bridge_protocol 32、helper_protocol 184、project_root 5、release_verdict 28，全部 OK。两个协议探针都通过，`git diff --check` 干净。
- PTY 第 5 轮（条件与第 4 轮相同：隔离环境、专用钥匙串条目、1 次启动、最多 8 条提交、10 分钟）**通过**，17/17。用了 6 条 composer 提交和 3 次对话框选择，扫描 554 个文件，0 泄漏。归档依次为 A、N1、N1，没有遗留 pending。[acceptance-evidence.json](../prototypes/queued-capture-proof/acceptance-evidence.json) 已换成本轮的结构摘要，临时报告已删除。

修复后的代码现在已有真实宿主验收。未运行发布门禁，插件版本仍为 0.1.0，未提交，未 push。
