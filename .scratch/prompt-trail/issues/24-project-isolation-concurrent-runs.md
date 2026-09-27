# 24: 隔离项目并支持并发 Run

**What to build:** 让多个项目、worktree 和同项目并发 Claude Code 进程安全共存：项目物理隔离，同项目 Run 保持独立 Active Branch 并共享确定的事件顺序。

**Blocked by:** 14「切换 Run collection mode」、17「跨 reload 与重启维护 Run 身份」、18「在 resume 与 fork 中重建 Conversation Branch」

**Status:** resolved

- [x] 每个规范项目根使用独立 SQLite 数据库；数据库只持久保存项目 hash，不保存绝对根路径。
- [x] 同一 Git 仓库的子目录和 symlink 归并到真实根，不同 worktree 得到不同 Project Timeline，移动后的路径视为新项目。
- [x] 非 Git 项目使用规范启动目录作为项目根，并遵循同样的 consent 与隔离规则。
- [x] 两个同项目 Run 同时提交时，各自保持独立 Active Branch，并通过短事务取得唯一、连续、项目级单调 sequence。
- [x] 至少 24 个并发 writer 全部提交；幂等重试不重复事件，相同 prompt 文本的不同事件保持独立。
- [x] disable 一个 Run 不改变另一个 Run 的 mode、pending、Active Branch 或写入能力。
- [x] 同一 Run 同一时刻至多一个存活进程接入；双终端并发 resume 同一会话时后到者成为新 Run（Issue 32），两个 Run 各自保持 Active Branch。
- [x] 一个项目的 locator、权限、I/O 或数据库故障不影响另一个项目的数据库和健康状态。
- [x] `status` 只显示当前运行时项目绝对路径和对应数据库路径，不泄漏其他 Project Timelines。
- [x] helper black-box concurrency/isolation tests 与双 PTY Run 场景验证顺序、分支、开关和物理隔离。

## Comments

### 2026-09-23 · Run 定义修订

Issue 32 把 Run 从「一个进程」改为「一条会话谱系」。本票的「并发 Run」仍指同一项目中同时接入的不同 Run；同一 Run 不会被两个进程同时接入（见新增条目）。

### 实现层面对齐（2026-09-27）

现状：大部分隔离已由前序票据做完。每个项目根一个 `<hash>.sqlite3`，库里只存 hash；项目根取 `rev-parse --show-toplevel`，非 Git 取启动目录，再 `realpath`，路径移动后就是新 hash；sequence 在 `BEGIN IMMEDIATE` 短事务里分配，`busy_timeout` 10 秒；mode、分支和生命周期队列都按 Run 分键；并发 resume 同一会话时，后到者开新 Run（Issue 32）；`status` 只报当前项目。缺口是：`capture-list` 不分 Run，并发 Run 会互相对账；`GIT_*` 环境变量和缺 Command Line Tools 时的 git shim 会让项目根判错或失败关闭；band 会把并发 Run 的条目和本 Run 的条目交错显示；另外缺少并发与隔离的测试。

- **存活 Run 的 pending**：helper 在执行 `capture-list` 时扫描 locator 目录，按 pid 和启动时间核对进程世代。所属 Run 有别的存活进程接入的 pending 不列出，只回一个 `skipped` 计数，`status` 显示「另有 N 条属于正在运行的 Run」。判断存活的代码从 bridge 挪到 common 共用。这样保留了 Issue 15「一个进程可以结清前一个进程留下的 pending」，同时不会去碰别的 Run 正在进行中的提交。
- **同一条孤儿 pending 被两个 Run 同时结清**：先到者生效。后到的 confirm 或 abort 回 `capture-settled-elsewhere`，插件清掉自己的 reconcile 记录，然后重新 discover，不阻止提交。
- **看到并发 Run 的事件**：不轮询。保留现有机制：本 Run 追加时发现 sequence 不连续，在底部重读；滚到 later 边缘时读取。另外，`/prompt-history` 展开时一律重读最新一批。
- **新条目计数**：仍只计本进程采集的条目（Issue 21）。
- **`GIT_*` 环境变量**：改用 `/usr/bin/env -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_CEILING_DIRECTORIES /usr/bin/git` 调用，项目根只由启动目录决定。
- **git 失败**：任何非 0 退出码都往上查 `.git`。查到就失败关闭，查不到就按非 Git 项目处理，用启动目录。项目根的判定抽成可测的纯函数。
- **band 显示**：只处理本 Run 起点之后的事件。每个其他 Run 折叠成一处「▸ 另一 Run · N 条」，锚点放在它在本 Run 起点之后的第一个事件上，它之后的 prompt 和边界行都收进这一处。N 只计 Prompt Entry，和「另一分支」共用展开状态与计数规则。本 Run 起点之前的历史不折叠。
- **Run 边界行**：不加 Run 短 id。起点之前的并发历史里，交错出现的「Run 开始」无法区分，这一点记进 backlog。
- **测试**：
  - helper 黑盒：24 个进程在 barrier 后同时对同一项目混合执行 `capture-begin`/`confirm`/`boundary-append`，sequence 恰好是 1..N；同一 event id 的重试不产生新行；相同文本、不同 event id 的事件互相独立；两个项目互相隔离，一个库损坏、权限异常或被删，另一个库的读写和 preflight 都不受影响；覆盖存活 Run 的过滤与 `settled-elsewhere`。
  - plugin test：另一存活 Run 的 pending 不触发对账；disable 一个 Run 不改另一个 Run 的 mode；`status` 不含其他项目的路径。
  - 纯函数：项目根判定（Git 子目录、symlink、worktree、非 Git、shim 失败）和其他 Run 的折叠；worktree 与 symlink 用真实 `git worktree add` 验证。
- **双 PTY 验收**：在 `pt21-project` 里开两个终端，覆盖 4 个场景：
  1. 两边交替提交，顺序一致，本 Run 的活动路径连续，另一 Run 被折叠；
  2. 一边 disable，另一边照常采集，`status` 显示两边的 mode 互不相同；
  3. 两边同时 `--resume` 同一会话，后到者成为新 Run，两边各自保持分支（同时补上 Issue 32 真人双终端的覆盖）；
  4. worktree 和非 Git 目录各自请求 consent，数据库文件各不相同。

### 实现中修订（2026-09-27）

- **同一条孤儿 pending 被两个 Run 同时结清（修订对齐稿）**：helper 已经能区分这两种撞车。先被丢弃、后再确认，返回 `capture-not-found`；先被确认、后再丢弃，返回 `capture-conflict`。所以不新增 `capture-settled-elsewhere` 类别，只在插件的对账路径里把这两个类别视为「已被别处结清」。存储里残留的 reconcile 记录指向一条早已结清的 pending 时，也走同一条路径。
- **`capture-list` 协议**：新增调用方 Run 参数（位于 project 之后），响应新增 `skipped`。判断存活时排除 helper 自己的宿主进程：进程内 `/resume` 改绑后，旧 locator 可能还在，它不能挡住旧 Run 的对账。进程存在但无法检查的，按 bridge 的规则仍算存活。
- **`status`**：已发现过 pending 时，每次都重新列出，保证「另有 N 条属于正在运行的其他 Run」不会显示过时的计数。
- **静态门禁**：hook 启动的可执行文件白名单改为扫描所有 hook 模块，并加入 `/usr/bin/env`。新增 `tests/project_root.py`，用真实 git 验证子目录、symlink、worktree 和 `GIT_DIR` 注入，并进入 `verify-startup.sh`；它同时检查 Python 与 `hooks/project.ts` 去除的变量列表一致。
- **既有断言更新**：`resume_fork_branch` 中「另一 Run 不折叠」的断言，按本票改为折叠成「另一 Run」。
- **Collection consent 跨 Run 共享（PTY 场景 4 发现，经使用者确认，Q11 选 a）**：在 `pt24-link` 提交时又问了一次 consent。时间戳表明，link 进程（16:35:50）启动得比 repo 进程点「启用」（16:36:17）还早。它在启动时把「未同意」缓存进 `project`，提交时 `prepareProject` 命中缓存，没有重读。symlink 归并本身没有问题：两个进程是同一个 hash，重启后 `status` 显示已同意。宿主事实（`claude -p` 探针实测）：`$.store` 的写入会立刻落盘，另一个进程，包括早已在运行的进程，下一次 `get` 就能读到，两个进程写不同的键也不会互相覆盖。修复分两处：
  - `prepareProject` 命中缓存时也从 `$.store` 刷新 consent。已经存下的决定一律以存储为准；存储里没有记录时，保留本进程的决定，比如「拒绝」写入失败的情况。
  - `requestConsent` 在询问前和询问后各读一次。两个 Run 同时弹出对话框时，按 Q2 的「先到者生效」：后答的一方采用已存的决定，不覆盖。
  - 后答的一方如果答案与已存的决定不同，会收到一条 toast：「另一个 Run 已先为本项目启用采集 / 选择不启用采集，这里的选择未生效。」不会在使用者不知情的情况下改变采集状态。

## Answer

多个项目、worktree 和同一项目的并发 Claude Code 进程可以安全共存。大部分物理隔离在前序票据里已经成立，本票补上的是并发 Run 之间的缺口、项目根的两个误判，以及测试。实现在 `38394f7`；consent 的修复在 `6cb018c` 和 `a1cef1f`，是 PTY 验收时发现的；与对齐结论不同的地方见上方「实现中修订」。

- **物理隔离（已有，本票补测）**：每个规范项目根一个 `<hash>.sqlite3`，库里只存 hash；路径移动后就是新 hash，需要重新 consent。一个项目的库损坏、权限放宽或被删，另一个项目的读写和 preflight 都不受影响。locator 按进程发布，本来就不跨项目；Run 级故障与共享档案故障的区分归 Issue 25。
- **项目根**：规则抽成纯函数 `hooks/project.ts`。
  - 调用 git 时用 `/usr/bin/env -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_CEILING_DIRECTORIES`，宿主继承来的环境变量不会把项目根带到别的仓库；
  - git 以任何非 0 退出码失败时都往上查 `.git`：查到就失败关闭，查不到就用启动目录。没装 Command Line Tools 的 Mac 上，非 Git 项目不再整体失败关闭；
  - 子目录和 symlink 归并到真实根，worktree 是独立的 Project Timeline，由 `tests/project_root.py` 用真实 git 验证。
- **并发 sequence**：沿用 `BEGIN IMMEDIATE` 短事务和 `busy_timeout`。24 个进程同时对一个尚不存在的档案执行预写、确认、重试确认和两次追加边界，全部提交，sequence 恰好是 1..48，每个 event id 只出现一次，相同文本各成一条。去掉 busy 等待后这个测试必然失败，说明争用确实发生了。
- **并发 Run 的 Pending Capture**：
  - `capture-list` 带上调用方的 Run，helper 扫描 locator 目录，按 pid 和启动时间核对进程世代。别的存活进程所在 Run 的 pending 可能正在提交途中，只计入 `skipped`，不列出；调用方自己的 Run 总会列出；helper 自己的宿主进程不算「别的存活进程」。
  - `status` 显示「另有 N 条属于正在运行的其他 Run」，每次都重新列出。
  - 两个 Run 同时结清同一条孤儿 pending 时，先到者生效。后到者撞上 `capture-not-found` 或 `capture-conflict` 时，视为已被别处结清。
- **Collection consent 跨 Run 共享**：consent 属于 Project Timeline，每次解析项目时都从 `$.store` 刷新，询问前后各再读一次。两个 Run 同时弹出同意对话框时，先答的生效；后答的一方如果选了不同的答案，会收到 toast 说明自己的选择没有生效。
- **band**：
  - 展开时一律重读最新一批，因为进程之间没有信号可用；
  - 本 Run 起点之后，每个另外写入过 prompt 的 Run 都折叠成一处「▸ 另一 Run · N 条」，锚点在它于起点之后的第一个事件上，它的边界行也收进去，N 只计 Prompt Entry；起点之前的历史照原样显示；
  - 新条目计数仍只计本进程采集的条目。
  - Run 边界行不加短 id，起点之前的并发历史无法区分，记入 backlog `20260927-concurrent-run-boundaries-before-start.md`。
- **宿主事实**（2.1.283，`claude -p` 探针实测）：`$.store` 是按插件划分的一个 JSON 文件，写入立刻落盘，另一个进程，包括早已在运行的进程，下一次 `get` 就能读到；两个进程写不同的键不会互相覆盖。`$.process.run` 的 `env` 只能覆盖变量，不能删除。
- **给后续实现者**：
  - `TargetOptions` 新增三项：`liveRuns`（`capture-list` 替身按调用方 Run 过滤）、`settledElsewhere`（替身按 helper 的类别回答撞车）、`duringAsk`（在 AskUserQuestion 弹出期间执行）；
  - 静态门禁改为扫描所有 hook 模块启动的可执行文件；
  - 测试引擎里没有 `setTimeout` 的类型。

门禁：`2.1.273`/`2.1.283` 各 **307** 项 plugin tests、8 静态、32 bridge、76 helper、5 项真实 git，TypeScript 与确定性重建全部通过。真人 PTY 在 2.1.283 上通过：
- 同一项目两个终端交替提交，两边顺序一致，各自的活动路径连续，另一 Run 被折叠；
- 一边 disable，另一边照常采集；
- 两个终端同时 `--continue`，后到者成为新 Run；
- symlink、worktree、非 Git 目录各自落在正确的项目；
- 另一进程后来才同意时，本进程不再询问；两边同时询问时，先答者生效，后答者收到提示。
