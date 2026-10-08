# Issue 53：跨 Run 损坏记录与写入原子化

## Context

使用者于 2026-10-01 选择重新开启延期的 major backlog，Issue 53 已 claimed。当前 $.store 只有 get/set/delete，无 CAS：archiveRecovered 的 get→delete 可擦掉另一 Run 的损坏报告；提交使用旧快照，重试还会跳过检查。再次读取只能缩小窗口，不能修复原子性。

目标：把 generation 的损坏事实放到 helper 的持久权威记录，让记录损坏与后续档案变更经过同一个串行化守卫。普通成功、普通错误或旧恢复结果都不能撤销它。Issue 35 保留 Q1–Q3，继续暂停；本票不修排队采集、不修改历史 Prompt Entry。

## 已确定的兼容边界

使用者选择 **「要求所有 writer 先升级」**，不采用 schema 3 屏障。

- 保持内部 schema 2、helper protocol 1、当前插件版本；不升级至 0.1.1。新增语义命令/响应字段与 sidecar 格式版本，不迁移档案 schema。
- 修复保证仅覆盖所有并发档案变更方均使用新版制品的项目：包括 capture、lifecycle、初始化/迁移/备份维护、quarantine、clear 等，不只是 composer writer。
- 部署前须退出旧制品接入及维护命令，用新版制品重新启动；旧 locator 不就地改写。helper 无法证明所有旧 writer 都退出，混版本仍可能绕过新守卫，**不宣称混版本窗口已修复**。
- 同一 Run 日后可由不同制品重新接入的原规则不取消；限制的是本次修复部署时的并发旧 writer。

## 推荐实现

### 1. 权威健康记录与显式初始化

在私有档案目录保存 generation 绑定的非正文健康 sidecar，字段仅含格式版本、generation、healthy/damaged 状态和随机状态 token。状态 token 在损坏发布及显式恢复时更新；恢复保留 healthy tombstone，不删除记录，从而区分“已恢复”和“记录缺失”。

- 复用 helper 的私有目录/文件检查、O_NOFOLLOW、临时发布、sync_file / sync_directory；拒绝符号链接、非法 owner/mode、坏记录及发布残留。缺失或无法校验表示 unknown，不包装成健康。
- 新的空档案由首个合法创建命令在守卫内建立 generation 和健康记录；已有档案第一次接入新版需显式初始化/完整复检，不能仅因普通写成功建立健康事实。
- 保留 integrity-check 的只读查询语义。拟新增公开 CLI seams：`archive-health`（轻量读取）、`archive-health-init`（已有档案初次完整检查并建立记录）、`archive-health-reset`（带 expected generation/token 的显式复检与恢复）。参数沿用项目身份、helper 摘要、protocol 的可信调用方式；输入/输出不含正文。
- init/reset 执行完整 integrity_check 与 foreign_key_check；只有检查完成且健康才发布 healthy。损坏/不可读保持 unavailable；未知 generation、缺失证据不算恢复成功。档案不存在只能在稳定项目边界、无未完成替换且预期证据匹配时退休对应旧记录。

### 2. helper 写入串行化与损坏发布

保留现有 project SH/EX 锁用于文件世代稳定与隔离/清除；新增每项目稳定的 health 排他锁，顺序固定为 **project → health → SQLite**，共用现有单调用 10 秒等待预算。

- 所有语义写入，以及 open_archive_at 隐藏的 WAL 设置、schema 初始化/迁移、metadata INSERT、备份维护，都在 health 守卫内检查当前 generation/健康状态并持有到事务及连接关闭；不能只保护 capture-begin。
- current-schema 正常读取走不做维护的快路径，不取得 health 写守卫；保留读取不等待普通 SQLite writer 的行为。读取确需初始化/迁移/维护时转入受保护路径并重新验证状态，不能持旧检查结果直接变更。
- 写路径发现 archive-integrity，在已有守卫内发布 damaged 后返回 generation/token；读路径发现损坏，先终止事务、释放 statements、真正关闭 SQLite，再保持 project SH 取得 health 守卫并重验 generation 后发布，避免反向锁序。
- 普通成功、archive-busy/full/read-only 等普通错误不覆盖 damaged。quarantine-failed 优先由现有持久 intent 表示，协调健康状态，不假借 quarantine/clear intent 表示一般损坏。
- 文件新建及 quarantine 的 fresh 文件要更新实际 opened_generation，不能把损坏事实错误记到旧世代或未创建前的空身份。

### 3. 证据绑定恢复与世代替换

- reset 在守卫内核验 expected generation/token，完整复检后以新 token 发布 healthy；旧 token 不匹配即拒绝，不清掉另一 Run 的新损坏事实。检查和状态发布不能拆成两次无绑定调用。
- quarantine / clear-all 继续使用 project EX，再按同一锁序协调健康记录；sidecar 纳入旧世代的迁移/删除及中断恢复，完成后才退休旧事实。新世代不能继承旧损坏，新世代已有损坏也不能被旧完成回执抹掉。
- health 锁文件是同步对象，不是可清除档案内容；清除不删除或替换正在使用的锁文件。更新 clear 的归属/计数与 quarantine 文件清单，保留其他项目和原始档案字节。
- clear-run、普通边界写入、pending 确认/丢弃不解除全项目损坏；旧 generation 的调用不能修改新记录。

### 4. plugin 集成与旧 store 记录

- readArchiveState / 提交、enable、status 和恢复入口读取 helper 权威状态。$.store 降为无正文显示镜像，镜像的 set/delete 结果不授权写入；核心安全门仍在每个 helper 变更命令内，早期读取后发生竞态也会被守卫拒绝。
- 调整 markUnavailable / archiveRecovered：普通错误不能在显示上降级已知损坏；普通成功只恢复普通故障。显式恢复使用 helper 的 generation/token 回执，并重新读当前状态；不再用无绑定 `settles-damage` 删除作为证明。
- retrying 只能处理允许重试的普通故障，不能跳过损坏/未知健康状态；移除缺 generation 就视为恢复成功的分支。
- 旧 v1/v2 store 损坏记录与无 generation 记录保持保守警告，要求显式初始化/复检，不能靠无行或普通写解除；已有 helper tombstone 是权威，旧镜像不能反复导入、重新覆盖已建立的状态。
- 未初始化/记录不可读时，明确显示“档案健康状态未知”并提供复检/初始化或禁用路径，不把 unknown 说成“已损坏”或“已恢复”。继续保留草稿恢复失败的真实提示。

## TDD seams（本计划批准即确认；批准前不写测试）

只在两个公开边界验证：① helper CLI 的结构化结果/退出类别与语义读取结果；② plugin 的 composer submit / control commands，使用共享 store 与 process responder。并发调度只在测试适配器中增加，不给正式代码添加隐藏故障注入开关。

逐条 RED→最小实现→GREEN，保留已有回归，不横向一次写完全部测试：

1. 初次健康记录与只读查询；普通失败不污染健康，未知/坏记录失败关闭。
2. 一方持久记录损坏后，另一方 mutation 被拒绝且无新事件；普通成功或 get→delete 镜像竞态不撤销事实。
3. writer / 损坏发布的有界确定性交错：按守卫线性化次序证明后续变更拒绝，不用 sleep 猜顺序；不要求已先获守卫的写入被事后撤销。
4. submit 读取后另一 Run 记录损坏，以及 retrying 路径仍被实际 helper 拒绝；Pending Capture/草稿/恢复状态正确。
5. stale token reset 拒绝；健康复检正确恢复；damaged/unreadable/缺 generation 不恢复；旧 mirror 不复活旧损坏。
6. quarantine / clear-all / clear-run、旧世代回执、新世代损坏、发布/替换中断的恢复。
7. 记录坏权限/链接/发布失败、隔离 fixture 的 kill；不泄漏正文、附件及凭据。
8. 当前档案读取不被 helper 写守卫无谓阻塞、24 并发写序列与总等待预算、schema 1→2 既有迁移回归。

已有 helper 损坏测试对“全部文件不变”的断言需区分原始 SQLite/WAL 字节与新增健康 metadata，不删掉原档案字节不变要求。hand-built legacy fixtures 经公开 init 建立前置状态；不以直接写私有 sidecar 正常数据代替 CLI 正向验证，文件破坏仅作负向故障注入。

## 修改范围

- `mods/prompt-history/src/prompt_history_helper.c`：守卫、健康语义命令、所有变更/维护入口、替换恢复。
- `mods/prompt-history/hooks/register.tsx`：健康响应校验、权威状态、损坏与重试/恢复入口；不改 Issue 35 资格。
- `mods/prompt-history/tests/helper_protocol.py`、`tests/quarantine_archive.test.tsx`、`tests/archive_unavailable.test.tsx`、`tests/clear_all.test.tsx`、`tests/clear_run.test.tsx`、`tests/support.tsx`：上述公开 seams 及现有回归，按需要局部增加。
- 构建生成的 helper/bridge、摘要、artifact.ts、generated header、manifest：由现有 build-artifacts.sh 重建，不手改；schema/protocol 矩阵保持原值。
- README、spec 对共享损坏权威/升级边界的说明、Issue 53、backlog 和地图；现有 Issue 35 原型及未提交改动原样保留。

## 验证与本次批准范围

批准后可修改上述正式文件、重建制品，并运行非模型的 helper/bridge/静态/plugin tests、TypeScript 与 startup verification。**批准同时涵盖这些测试在专用 TemporaryDirectory 内的 fixture 文件写入/损坏、SQLite/flock 锁竞争、权限与子进程终止**；不得作用于真实 HOME、档案、其他会话或未由测试创建的对象。新增健康文件纳入隐私断言。

顺序：每个竖切定向测试 → 全 helper 回归 → 两个固定宿主版本 2.1.273/2.1.283 的 plugin validate/test → TypeScript、其余单元测试 → 重建并检查确定性 → verify-startup.sh → git diff --check。plugin test 是非模型测试，不使用 PTY/钥匙串。startup 首次因制品过时失败须如实记录，重建后再验证。

本轮 **不运行真实 PTY/模型或完整发布门禁，不使用 chflags/hdiutil，不部署或初始化真实项目档案，不升级插件版本，不 commit/push**。真实验收与发布另行授权；仅单元/插件门禁通过不能报告真实 PTY PASS。

## 保证与停点

保证从损坏事实**成功持久发布**的线性化点开始。读取首次发现损坏到取得守卫之前，已先获守卫的 writer 可能完成；不宣称撤销该写入。sidecar 与 SQLite/store 没有跨资源事务，无法落盘或发布前 kill 的事实不能保证跨进程已知；本调用保持 blocked、残留视为 unknown，明确报告不确定性，不冒充持久记录成功。

不覆盖旧 helper 或绕过锁的外部工具。若实施时不能关闭反向锁序、覆盖全部维护变更、绑定恢复身份或保持读取回归，停下记录缺口，不能通过放宽断言宣称修复。Issue 53 在获批准、实现并完成适当验证前保持 claimed；Issue 35 继续暂停。

参考：SQLite 官方 transaction 与 WAL 文档确认只支持一个并发数据库 writer、正常 WAL reader/writer 并发；不提供外部 sidecar 的事务原子性。https://www.sqlite.org/lang_transaction.html 、https://www.sqlite.org/wal.html 。
