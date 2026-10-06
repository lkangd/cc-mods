# 53: 跨 Run 损坏记录与写入原子化

**What to build:** 修复共享损坏事实与档案写入之间的竞态：一个 Run 已记录当前 Archive generation 损坏后，另一个 Run 的普通成功写入不能删除该事实；已有损坏事实必须在后续档案变更的串行化边界内生效，不依赖提前读取的 $.store 快照。

**Blocked by:** 51「另一个 Run 的写入撤掉损坏报告并继续写坏档案」

**Status:** resolved

- [x] 确定共享损坏事实的权威存储、Archive generation 绑定与原子化边界；不得将再次读取 $.store 包装成彻底修复。
- [x] 普通写入成功不能撤销其他 Run 已记录的损坏事实。
- [x] 已记录损坏的 generation 拒绝后续变更；重新检查通过、隔离、清除与旧 generation 退役的恢复规则须明确，不静默丢失损坏事实。
- [x] 写入、损坏记录、恢复、并发及崩溃故障的测试 seams 在实现前确认，逐项 RED→GREEN；旧行为回归保持通过。
- [x] 明确 helper/protocol/schema/制品的实际影响，保持正文隐私、helper 信任与 Run 隔离，不借此修复 Issue 35。
- [x] 审查修复后重新通过完整 helper/startup 系统门禁；需要追加授权，不能复用修复前 PASS。

## Comments

### 2026-10-01 · 从延期 backlog 重新开启

使用者选择「跨 Run 损坏竞态（推荐）」，授权重新开启 [既有 major backlog](../../../docs/code-review-backlog/20260930-damage-record-check-then-act-across-runs.md) 并先制定修复计划；此前 2026-09-30 的延期选择被本次重新开启取代。

原窗口包括 archiveRecovered 的 get→delete 擦除另一 Run 的损坏报告，以及提交路径使用旧 archiveFailure 快照后继续写入。旧建议把损坏事实放在 helper 串行化边界，只是待核对设计，尚未批准。

本次先只读调查并提交实施计划。正式修改须等计划批准；真实模型调用、PTY 故障注入、本机锁/权限/卷操作、版本升级、commit 或 push 不在本次选择授权内。Issue 35 继续保留 Q1–Q3 并暂停在宿主契约缺口，本票不变更其成员资格或采集协议。

### 2026-10-01 · 兼容边界与实施计划批准

使用者选择「要求所有 writer 先升级」，不采用 schema 3 屏障：保持 schema 2、protocol 1 和当前插件版本，部署前退出所有旧制品接入及维护调用，用新版重新接入。无法自动证明旧 writer 都已退出；混版本窗口不宣称修复。

随后批准 Issue 53 实施计划：helper 保存 generation/state/token 绑定的权威健康 sidecar，所有变更/维护通过同一 health 守卫；恢复在守卫内复检并验证 generation/token，保留 healthy tombstone；store 仅显示镜像。已有档案未初始化/状态缺失为 unknown，须显式初始化/复检，正常当前 schema 读取保留并发。

已确认测试 seams 为 helper CLI 与 plugin 公开 submit/control。批准包括正式文件和生成制品修改，以及专用 TemporaryDirectory 内的 fixture 损坏、权限、锁竞争和测试子进程终止；不涉及真实档案/HOME/其他会话。按逐条 RED→GREEN 开始实施。真实 PTY/模型、钥匙串、chflags/hdiutil、插件版本升级、commit/push 与发布门禁仍未授权。成功持久发布前的故障不冒充跨进程已知损坏，Issue 35 继续暂停。

### 2026-10-01 · 首批 helper CLI 竖切（实施中，未修复）

新增 archive-health 查询与 archive-health-init 显式完整检查/持久回执；健康记录使用 generation/state/token，原档案字节不变。初始化使用 project→health 锁与临时发布/同步。4 个公开 CLI 测试逐项先 RED 再 GREEN：无档案不建文件、未初始化档案 unknown 且给出 generation、健康初始化回执可跨调用查询、损坏初始化回执可持久查询。当前定向 4/4；生成制品已由构建脚本重建，schema 2/protocol 1 未变。

尚未完成所有变更/维护入口守卫、自动损坏发布、绑定恢复/reset、世代替换协调、plugin 集成与完整回归。这是接口与持久记录竖切，不是竞态修复 PASS，票据仍 claimed。

准备完整回归时发现 helper_protocol 现有测试含 hdiutil 临时卷与 chflags 操作，超出刚批准的“无 hdiutil/chflags”范围；目前仅运行上述定向测试，没有执行这些系统操作，也未运行完整 helper/startup/发布门禁或真实 PTY/模型。若运行完整回归，须追加明确授权。

使用者随后选择「允许隔离测试操作（推荐）」：追加授权仅在测试自己的 TemporaryDirectory 对象上执行 hdiutil 创建/挂载/卸载临时卷及 chflags 设置/清除文件标志。本次完整 helper 回归和 startup 门禁各最多一轮；涉及这些系统操作的失败定向复跑另行授权。此追加授权作出时两轮预算均未使用，未运行 hdiutil/chflags。真实档案、模型/PTY、版本升级、commit/push 仍不在授权内。

### 2026-10-01 · helper 守卫与绑定恢复（实施中，未修复）

已定向验证新空档案首笔创建健康回执、已有档案 unknown 拒写、读取损坏关闭 SQLite 后持久发布、generation/token 绑定 reset 与 stale 拒绝、不可读不解除损坏、迁移/备份维护读取守卫、clear-run 不解除损坏、quarantine 迁移旧健康记录并建立新世代、旧隔离续接不退休新损坏、clear-all 退役记录但保留稳定 health 锁、未知 schema 与非法 token 拒绝。新行为逐项 RED→GREEN；另有基于实际 flock 所有权的并发顺序回归直接 GREEN，不把它记为新 RED 竖切。当前 schema 读取与 24 Run gapless sequence、迁移保留备份、原始损坏分类、只读完整检查的定向旧回归通过。

legacy fixture 经公开 archive-health-init 建立新版 writer 前置状态；原始 SQLite/backup 字节仍独立断言，健康 metadata 通过公开 CLI 与隔离迁移字节单独检查，不将原档案不变要求删除。plugin 集成仍在实施，不宣称 Issue 53 已修复。

追加授权中的唯一一轮完整 helper 回归已结束：171 tests，17 个失败断言，未通过。失败集中于旧文件清单未纳入健康记录/health.lock，以及两处手工 schema-1 fixture 和 migration-kill restore 缺显式初始化。已修正这些前置/清单；按 AST 检查测试及其 fixture 调用闭包，14 个不含 hdiutil/chflags 的失败测试定向复跑，首次 13 通过、另 1 仍有旧隔离文件清单断言，修正后该项通过。涉及 chflags 的 clear 残留测试只修正清单，未定向复跑。

helper 完整轮预算已使用 1/1，startup 仍 0/1。只允许测试 TemporaryDirectory 内的 hdiutil/chflags；涉及这些操作的失败定向复跑须另获授权。补充负向健康证据（缺失/坏 JSON/权限/symlink/partial）拒写与 health writer 锁不阻塞当前 schema 读取的回归直接通过，不冒称新 RED 竖切。

### 2026-10-01 · 健康发布中断窗口（实施中，未整体验收）

普通文件 helper 子集首次 162 tests，1 个随机 quarantine-kill 续接失败（database-unavailable）。随后补确定性的空/截断 health.partial 发布中断，先 RED；显式隔离续接现在完整复检后重发健康回执，已 GREEN，旧隔离不退休新损坏及损坏 replacement 回归通过。随机 kill 定向复跑也通过，不将单次成功当成全部崩溃场景证明。

只读核验发现另一侧窗口：rename 消耗 partial 后若目录同步失败，reset 报失败而后续 query 返回未完成持久发布的 healthy。仅对测试子进程/TemporaryDirectory 的文件系统适配器令此次目录 fsync 返回 EIO，公开 CLI 测试实际先 RED 再 GREEN。发布改为保留 partial 门、通过 ready 硬链接 rename；先持久 gate，再持久正式回执，才清门。最后清门目录同步 best-effort 不影响已经持久的回执，重启若门复现仅保守 blocked。无锁 query 读取后再复核 gate；适配器用管道屏障固定在初次 gate 检查后、receipt open 前，另一调用 reset 发布失败后再放行，直接 GREEN 回归证明不会返回新 healthy（不虚报这个补充交错曾单独 RED）。

隔离 partial/ready/both/rename 后残留保留已发布 damaged/token 的回归直接 GREEN。另补不可信 stage 权限/链接 4 个负向场景，全部先 RED，再最小私有文件校验后 GREEN；续接不删除这些证据、不改档案与正式回执。生成制品已重建，schema/protocol/插件版本未变。

修发布窗口后，按 AST 排除 hdiutil/chflags 及 self fixture 调用闭包的普通文件子集 165 tests 全通过；之后新增暂存权限/链接测试及查询交错扩展已定向通过，不冒称此前子集包含后续编辑。

plugin 集成已完成：移除无绑定 settles-damage 恢复；健康 tombstone 压过旧镜像；普通成功/镜像 get→delete 竞态、late damage、retry/enable、旧 reset 与新代损坏、clear-run/clear-all 回归通过。最终两固定版本 2.1.273/2.1.283 非模型 plugin test 各 475 pass/0 fail，validate 均通过；TS5.9.3 strict tsc 通过。残留/非法健康记录的 unknown 显式 init 不承诺一定修好，拒绝时仍 blocked；公开 clear-all 是另一条强确认恢复路径。

唯一 startup 门禁已启动，预算已使用 1/1；后续实际结果见下方 Answer。不再另跑含 hdiutil/chflags 的失败定向测试。真实模型/PTY、发布、升级、commit/push 未执行。

## Answer

2026-10-01：Issue 53 的正式实现与统一非模型验证完成，按此范围 resolved。

- 权威健康记录位于 helper 私有 sidecar，仅保存项目/formatVersion/generation/state/token。普通成功、错误、重试、clear-run 与 store 镜像 get→delete 都不能解除持久损坏；store 仅作显示。
- 变更和隐含维护在 project→health→SQLite 守卫内核验；读损坏真正关闭 SQLite 后才取 health 守卫发布。正常 current-schema 读取不等待 health writer。
- 恢复完整复检并绑定 generation/token，stale 拒绝，healthy tombstone 保留；quarantine/clear-all 协调世代退役，稳定 health.lock 不删除。发布 partial/ready 门跨 rename 保留，正式回执目录同步完成后才清理，恢复不解除新代已发布损坏。
- 唯一 `verify-startup.sh` 实际 exit 0：两固定版本 2.1.273/2.1.283 各 475 plugin tests / 0 fail，validate 通过；TypeScript 5.9.3 通过；artifact_static 9、bridge_protocol 32、helper_protocol 177、project_root 5、release_verdict 28 全部通过，无跳过。制品重建前后摘要/权限一致，支持 probe 与 protocol mismatch probe 通过。最终 git diff --check 通过。
- 首轮 helper 的 171/17 失败与后续普通子集 162/1 失败保留上方历史；本次 startup 的完整 helper 177/177 才是最终全套通过证据。系统操作仅触测试 TemporaryDirectory；helper 全轮与 startup 预算各已用 1/1，未额外执行含系统操作的失败定向复跑。
- 日志：`/private/tmp/claude-501/-Users-liangkangda-Fe-project-cc-mods/4dae065f-35c8-4563-92c5-9f7bd10a703c/startup-issue53-final.log`。
- schema 2 / protocol 1 / 插件 0.1.0 不变；正式部署仍要求所有旧 writer 退出后用新制品重新接入，不覆盖混版本或绕过锁的外部写入。保证从损坏成功持久发布开始，不撤销更早取得守卫的 writer。
- 没有部署、真实 PTY/模型验收、完整发布门禁、版本升级、commit 或 push。Issue 35 的 Q1–Q3 与宿主身份契约停点不变；本票不修排队成员资格，也不改历史误归档记录。

### 2026-10-02 · 单轮 code-review 重新开启修复

使用者选择只审查 Issue 53 未提交改动，排除 Issue 35 原型/历史改动。独立外部单轮审查已结束，结果位于 `.code-review/runs/20261001-234125/round-1/out/findings.json`：13 项（10 CONFIRMED、3 cleanup PLAUSIBLE/未经 verifier）。先前 resolved 状态重新改为 claimed；上方 Answer 是 2026-10-01 修复前版本的完整门禁证据，不作为随后修改的门禁结果。

主会话逐项读源码复核后，插件侧清除后旧损坏镜像阻塞新建、已由其他 Run 完成清除的残留镜像、disabled Run 无显式健康初始化入口、clear-run unknown 拒绝缺恢复指引分别补公开 submit/control RED→GREEN。普通成功的镜像清理只需一次 post-delete 权威刷新；保留 late damage 阻塞回归，不再重复健康查询。旧测试曾仅造 damage store mirror 而 helper 默认 healthy，已明确改成 healthy tombstone 退休旧镜像的行为；真实 helper damage 的独立阻塞回归保留。2.1.283 当前插件 479 tests 全通过，随后新增 init 查出损坏仍保持停用的补充回归，待最终复跑。

PTY clear-all 脚本的剩余清单改为 project.lock 与稳定 health.lock 两项，描述同步；只做 Python AST 语法检查，没有执行真实 PTY/模型或完整发布门禁。helper 诊断/已有 receipt 初始化/clear-run cut 后损坏发布/拒绝路径健康断言及小清理由独立修复代理接续；第一代理因 API 429 终止，不将其开场承诺当完成报告。

本轮没有新增 hdiutil/chflags 授权。完整 helper 与 startup 系统轮预算仍各为已用 1/1，之后仅允许运行经 AST 排除系统操作及 self fixture 调用闭包的普通 TemporaryDirectory 测试；真实验收、部署、升级、stage/commit/push 均未执行。

### 2026-10-02 · 单轮审查处置完成；完整系统门禁待授权

主会话已逐项核对当前实现；13 项均 fixed，未新增 backlog 条目、未 reject。原审查 verdict 保留：10 CONFIRMED、3 cleanup PLAUSIBLE。后者按审查策略未经过独立 verifier，主会话自行核实重复调用/重复逻辑成本和最小清理后的行为，不将其改称独立验证结果，不声称测得延迟改善。

| # | Severity / verdict | Angle | 当前修复位置 | 处置 |
| --- | --- | --- | --- | --- |
| 1 | major / CONFIRMED | correctness | `mods/prompt-trail/hooks/register.tsx:1796` | fixed：helper 成功证明 absent 才退休旧 health failure 镜像，允许首次创建；查询故障仍 blocked。公开提交 RED→GREEN。 |
| 2 | major / CONFIRMED | callers | `mods/prompt-trail/hooks/register.tsx:6011` | fixed：disabled Run 的 enable 提供显式初始化；失败/取消保持 mode，不创建 Prompt Entry。公开 control RED→GREEN，查出损坏保持停用的补充回归 GREEN。 |
| 3 | major / CONFIRMED | callers | `mods/prompt-trail/release/pty_scenarios.py:1995` | fixed：clear-all 剩余清单/描述包括 project.lock 与 health.lock；仅 AST 语法验证，真实 PTY 未运行。 |
| 4 | major / CONFIRMED | removed-behavior | `mods/prompt-trail/src/prompt_trail_helper.c:3516` | fixed：完整诊断关闭 reader 后重核 generation、发布真实损坏；两次 PRAGMA 的失败类别在 finalize/close 前捕获，FK 返回不再忽略。原 DB/WAL 不变，健康诊断不恢复。原缺失损坏发布 RED→GREEN。 |
| 5 | major / PLAUSIBLE | cleanup | `mods/prompt-trail/hooks/register.tsx:1934` | fixed：普通成功仅一次 post-delete 权威刷新；begin/confirm 各由两次降为一次 post-write health probe，仍保留绑定 receipt 检查及 late damage 阻塞。主会话核实成本，回归 GREEN。 |
| 6 | minor / CONFIRMED | removed-behavior | `mods/prompt-trail/hooks/register.tsx:4736` | fixed：其他 Run 已完成 clear-all 时，退休无活动 generation 的旧镜像；新代状态仍由 helper 权威决定。公开 control RED→GREEN。 |
| 7 | minor / CONFIRMED | callers | `mods/prompt-trail/hooks/register.tsx:6717` | fixed：clear-run unknown/stale 提示 enable 显式完整复检或强确认 clear-all，不隐式初始化、不删记录。公开 control RED→GREEN。 |
| 8 | minor / CONFIRMED | correctness | `mods/prompt-trail/src/prompt_trail_helper.c:640` | fixed：cut 后完整性失败先持久发布 damage，再返回 clear-run-unfinished；intent 与损坏 token 保留，修好数据库不授权续清。真实 SQLite writer/公开 --continue RED→GREEN。 |
| 9 | minor / CONFIRMED | spec | `mods/prompt-trail/src/prompt_trail_helper.c:4174` | fixed：已有 receipt 的 init 仍完整复检；clean init 幂等、已有 damaged/token 不解除。公开 CLI RED→GREEN。 |
| 10 | minor / CONFIRMED | removed-behavior | `mods/prompt-trail/tests/helper_protocol.py:4128` | fixed：通用拒绝断言另核公开健康回执 state/generation/token；预期损坏发布明确断言 token 转换，保留 SQLite/backup/WAL 原字节及负向健康证据。涉及系统 fixture 的调用点仅静态修改，未运行。 |
| 11 | minor / PLAUSIBLE | cleanup | `mods/prompt-trail/src/prompt_trail_helper.c:4049` | fixed：establish 与 init/reset 共用完整性/schema/project 验证；主会话核对两处调用，回归 GREEN，不虚构 RED。 |
| 12 | nit / CONFIRMED | callers | `mods/prompt-trail/tests/helper_protocol.py:3919` | fixed：archive_files 排除 health.ready，健康 metadata 与 SQLite 字节分开核验；stage snapshot RED→GREEN。 |
| 13 | nit / PLAUSIBLE | cleanup | `mods/prompt-trail/src/prompt_trail_helper.c:3475` | fixed：readonly opener 统一 temp_store=MEMORY，删除同一读取连接的重复 pragma；写入/其他连接的隐私设置保留。主会话核实重复成本，回归 GREEN。 |

诊断补正的事实更正：主会话曾怀疑 count_problems 的 false 会把普通 busy 误发布损坏，但旧函数对普通错误已在内部 archive_error 分类退出，false 只对应 NOTADB；真实 exclusive-lock 回归补正前后均 GREEN，不记录为新 busy RED。本次将分类显式带回调用方，在关闭 reader 后统一处理，并处理 FK 检查返回值。新增真实 FK violation + 非空 WAL 回归首次 GREEN，证明发布 state/generation/token、保留 DB/WAL 字节与重复诊断保持 damaged token，不虚构 RED。

修复后主会话统一验证（最新制品；不是完整 startup）：

- AST 筛查 249 个方法及 self fixture 可达闭包，全套 184 中预先排除 11 个 hdiutil/chflags 可达测试；普通文件 helper 173/173，149.884 秒，exit 0，无残留失败。不能表述为完整 helper PASS。
- 两固定宿主 2.1.273 / 2.1.283 的 plugin test 各 480/480，validate 均通过；TypeScript 5.9.3 与 git diff --check 通过，整条命令 exit 0。
- artifact_static 9、bridge_protocol 32、project_root 5、release_verdict 28，共 74/74，exit 0。这里的 release_verdict 是合成证据单元测试，不是发布验收。
- 正式 build-artifacts.sh 重建前后，helper/bridge/manifest/artifact.ts/generated header 的 SHA/type/mode 完全相同；supported probe 与 protocol mismatch probe 通过。无手改制品，schema 2 / protocol 1 / 插件 0.1.0 不变。
- PTY 场景脚本 AST 语法通过，没有运行真实 PTY/模型、钥匙串、发布门禁、hdiutil/chflags、真实 HOME/archive 初始化、部署或版本升级。未 stage/commit/push，未修改 Issue 35 的 Q1–Q3、成员资格或历史误归档记录。

日志：`/private/tmp/helper-issue53-review-no-system.log`、`/private/tmp/plugin-issue53-review-post-helper-gates.log`、`/private/tmp/issue53-review-other-python.log`。普通子集调度器：`/private/tmp/issue53-review-no-system.py`。

审查只执行一个 round，没有启动 adversarial/re-review。结果路径仍为 `.code-review/runs/20261001-234125/round-1/`；对照文档为批准计划 `.claude/plans/jiggly-questing-charm.md`、本票据与 `.scratch/prompt-trail/spec.md`。README/spec/map 与既有 backlog 已同步当前语义及验证边界。

Issue 53 保持 claimed，旧 major backlog 保持 open，停在修复后完整 helper/startup 系统门禁的新增授权缺口。2026-10-01 的完整 PASS 仅保留历史，不挪用为审查修复后版本证据。

### 2026-10-02 · 收尾提交授权

使用者要求“收尾提交，然后编写交接文档”。本次提交范围限定为 Issue 53 正式实现、13 项审查处置、生成制品、批准计划及对应文档；混合 map 只暂存 Issue 53 内容，Issue 35 票据/原型/地图改动留在工作区。交接文档写入系统临时目录，不入仓库。

本次提交授权不扩大测试、真实模型/PTY、部署、发布、版本升级或 push 权限；票据保持 claimed，旧 backlog 保持 open，等待修复后完整系统门禁的新授权。提交前的“不提交”记录是当时边界，不作为本次收尾提交的禁止条件。

### 2026-10-06 · 修复后系统门禁授权

使用者选择「一轮 startup（推荐）」：授权运行一次 `verify-startup.sh`（含完整 helper 测试），hdiutil/chflags 仅作用于测试自己的 TemporaryDirectory。失败时不复跑涉及系统操作的测试，先停下汇报；通过则更新票据/backlog/map。真实模型/PTY、钥匙串、真实 HOME/archive、部署、发布、版本升级、commit/push 仍不在授权内。授权作出时本轮预算 0/1。

### 2026-10-06 · 修复后完整系统门禁通过，resolved

按上方授权运行的唯一一轮 `verify-startup.sh` 跑在已提交的 `9a86c73` 上（工作区只有 Issue 35 和本票据的文档改动），exit 0，打印 `Prompt Trail startup verification passed.`：

- 制品重建前后 helper/bridge/manifest/artifact.ts/generated header 的 SHA 与 helper/bridge 的 type/mode 一致，没有脚本报 stale；`git status` 显示 `mods/` 下无改动。
- 两固定宿主 2.1.273 / 2.1.283：plugin validate 均通过，plugin test 各 480 pass / 0 fail；TypeScript 5.9.3 strict tsc 通过。
- artifact_static 9、bridge_protocol 32、helper_protocol 184、project_root 5、release_verdict 28，全部 OK、无跳过。完整 helper 184 包括此前普通子集排除的 11 个 hdiutil/chflags 测试，系统操作只作用于测试自己的 TemporaryDirectory。
- supported probe（protocol 1，darwin-arm64-macos15）与 protocol mismatch probe 通过。之后 `git diff --check` 通过。

预算已用 1/1，没有失败，所以没有复跑。日志：`/private/tmp/claude-501/-Users-liangkangda-Fe-project-cc-mods/1900222a-ac03-4c17-b3c2-6b33b35fc2db/scratchpad/startup-issue53-post-review.log`（会话临时目录，可能被清理；计数以本节为准）。

这是审查修复后版本的完整非模型门禁 PASS，取代 2026-10-02 的「待授权」停点；Issue 53 按此范围 resolved，旧 backlog 同步 resolved。范围仍然有限：schema 2 / protocol 1 / 插件 0.1.0 不变，部署前所有旧 writer 须退出并用新制品重新接入，不覆盖混版本窗口。没有运行真实模型/PTY 验收、钥匙串、真实 HOME/archive、部署、发布门禁、版本升级，也没有 commit/push。Issue 35 的 Q1–Q3 与宿主契约停点不变。
