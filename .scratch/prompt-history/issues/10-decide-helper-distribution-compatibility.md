# 决定 helper 分发与平台兼容矩阵

Type: grilling
Status: resolved
Blocked by: 09

## Question

在 SQLite 原型仅验证 macOS arm64、动态链接系统 `libsqlite3`，且 function hook 必须经 command-hook locator 桥调用 helper 的前提下，Prompt Trail MVP 应支持哪些 OS/架构，如何构建、校验、选择和更新随插件分发的 helper 与 SQLite，遇到缺失、不兼容、隔离/签名拒绝或不受支持平台时如何明确降级，并怎样处理 `--plugin-dir`、marketplace 更新、卸载与 `--keep-data` 的路径生命周期？

## Answer

采用“**单一实证平台、预构建单一制品、系统 SQLite、Run 级版本绑定、不可用时失败关闭**”的契约。MVP 不把尚未验证的平台或分发方式写成支持，也不在运行时下载、编译、替换或绕过系统策略。

### 1. 正式支持矩阵

| 维度 | MVP 承诺 |
|---|---|
| OS | macOS 15.x |
| 架构 | 原生 arm64；不含 x86_64、Universal 2 或 Rosetta |
| Claude Code | `>=2.1.273` early-access function hooks，交互式终端；`2.1.273` 为最低兼容版本 |
| 加载方式 | 从可信本地目录使用 `--plugin-dir`；不含 marketplace 或下载后的 zip |
| Helper | 随插件提供的 thin arm64 Mach-O |
| SQLite | 动态链接 macOS 系统 `/usr/lib/libsqlite3.dylib` |

Linux、Windows、WSL、Intel Mac、macOS 14 及更早版本、非终端表面、Claude Code `<2.1.273` 或无法证明版本均为**未支持**，不是“尽力可用”。更高 Claude Code 版本不因版本号本身被拒绝，但任何协议、API 或运行期能力不兼容仍失败关闭。

现有原型只证明 Claude Code `2.1.273`、macOS arm64、本地非 quarantine 路径可工作；当前制品恰为 thin arm64、`minos 15.0`，动态依赖系统 SQLite。它不能证明其他矩阵单元。

### 2. Helper 制品契约

- 插件携带一个目标为 `darwin-arm64-macos15` 的**预构建 helper**；同时保留 C 源码、固定参数的构建脚本和产物检查脚本。安装、启动和首次采集均不要求 C/Rust 工具链，也不现场编译。
- 构建显式固定 arm64 与最低 macOS `15.0`，并记录编译器、SDK、链接器、构建来源和构建命令；不得继续继承构建机的隐式默认值。这里要求可追溯、可复核，不在没有证据时宣称字节级可复现。
- 制品清单记录 target、文件名、SHA-256、helper protocol、可读写 schema 范围、最低系统 SQLite 能力及动态依赖。发布检查必须验证 Mach-O 类型、PIE、deployment target 和依赖仅为允许的系统库。
- function hook 随发布版本固定预期 helper 摘要；摘要用于发现缺失、误配或意外替换，不宣称抵御能同时篡改插件与 helper 的当前账户或 root。
- 不捆绑 SQLite，也不静态链接自行维护的副本。helper 启动时读取实际 SQLite 版本并执行所需能力探针；最终 SQL/API 所需的最低版本写入制品清单。当前原型使用 `UPDATE … RETURNING`，因此若保留该实现，最低版本不得低于 SQLite `3.35.0`。

当前 prototype binary 及其 `build.sh` 只是证据资产：脚本未固定架构、deployment target 或 SDK，也没有正式 manifest、hash、选择器和发布门禁，不能原样视为 MVP 发布制品。

### 3. 选择、定位与启动探针

- 只有一个受支持 target，因此不做模糊 fallback 或“挑一个能运行的 binary”。`SessionStart` command-hook 桥先核对 OS、架构和 macOS 主版本，再选择唯一制品；不匹配即发布明确的 unsupported 状态。
- command hook 是 `${CLAUDE_PLUGIN_ROOT}` 与 `${CLAUDE_PLUGIN_DATA}` 的唯一权威来源。helper 代码位于 plugin root，项目级数据库位于 plugin data；prompt 原文不得写入 plugin root、locator、argv 或诊断。
- bridge 发布按 session 隔离的 locator，至少绑定：规范 helper 路径、数据库根、helper SHA-256、plugin/helper protocol、session、宿主进程世代和 Run。function hook 每次使用前按《决定存储安全与故障策略》复核 owner、权限、对象类型、规范路径、目录归属、世代和摘要。
- 首次 Collection consent 或数据库创建之前，必须完成 locator、制品、helper protocol、SQLite 能力及只读健康握手。探针本身不得创建 Prompt Entry 或项目数据库；未通过时不得把“启用”呈现为可成功的选项。
- Claude Code `2.1.273` 是最低兼容版本。宿主版本必须可解析为严格的三段数字且不低于该版本；版本无法证明或其他能力探针失败时，采集保持不可启用。

### 4. 更新与路径生命周期

- 一个 Run 绑定启动时 locator 中的 helper 路径、摘要和 protocol。`/reload-plugins` 只可继续使用摘要未变的 helper；helper 内容、路径或 protocol 变化后必须退出并新建 Run，不做运行中热切换。
- 新 Run 由 command hook 从当前 plugin root 重新发布 locator，因此插件目录可在 Run 之间变化；活动 Run 中目录被移动、删除或替换则进入 Archive unavailable，不沿用陈旧路径。
- helper 更新必须先通过 schema 兼容矩阵。新 helper 只执行已知的单向迁移；旧 helper 遇到更高 schema 必须拒绝打开。迁移、备份和并发规则沿用《决定存储安全与故障策略》。
- 正常 SessionEnd 删除本 session locator；异常遗留只在能证明 owner、格式、世代及对应进程已终止时清理。删除或移动 `--plugin-dir` 目录不等于清除档案，产品不得声称数据已删除。
- `--plugin-dir` 没有 uninstall 生命周期。MVP 文档必须要求在移除插件前使用 Prompt Trail 自身的删除命令，并说明移除后遗留数据可能需要按已展示的路径人工处理。

### 5. Marketplace 边界

Marketplace 发布、更新和卸载仍在本 effort 范围外，不纳入 MVP 验收。本次只锁定前向兼容原则：

- 可执行代码只在 plugin root，持久档案只在 `${CLAUDE_PLUGIN_DATA}`，桥 locator 独立且可安全失效；
- 不把 plugin cache 内路径当作跨 Run 永久身份；
- 未来支持 marketplace 前，必须实测多 scope 更新、最后一个 scope 卸载、默认数据删除、`--keep-data` 保留和外部 locator 清理；未实测前不得作产品承诺。

### 6. 明确失败行为

| 场景 | 行为 |
|---|---|
| OS、架构、macOS 主版本或宿主版本不受支持 | 不请求 consent、不创建档案；`status` 显示 unsupported target |
| Helper 缺失、非普通文件、不可执行、摘要不符或动态加载失败 | Helper unavailable；给出不含 prompt 的实际路径与错误类别，不自动下载或编译 |
| Helper protocol、schema 或 SQLite 能力不兼容 | Archive unavailable；不猜测降级、不换用其他 binary 或 SQLite |
| macOS 隔离、签名或企业策略导致执行被拒 | 按普通执行拒绝报告；不自动修改 xattr、权限或系统安全策略，也不引入 Developer ID/公证要求 |
| Run 中 helper 被移动或替换 | 当前 Run 停止采集；必须恢复原制品或新建 Run |
| 已启用后的共享档案故障 | 依《决定存储安全与故障策略》阻止 composer 提交，允许重试或明确禁用当前 Run 后继续 |

不提供内存时间线或无持久化的隐式 fallback，因为它会与“永久、完整且显式标界”的产品承诺混淆。`status` 与必要诊断在失败状态下仍须可用。

### 7. 后续验收门禁

《定稿兼容与验收契约》至少应覆盖：

1. 在 macOS 15.x arm64、Claude Code 最低兼容版本 `2.1.273` 与当前发布验收版本、本地 `--plugin-dir` 下验证启动、reload、退出重启与数据库延续；
2. 检查 target、`minos 15.0`、动态依赖、SHA-256、protocol/schema manifest 和系统 SQLite 能力；
3. 注入 unsupported target、缺失文件、无执行权限、摘要不符、错误 protocol、过高 schema、SQLite 能力不足与 dyld/执行拒绝；
4. 验证 helper 不变时 reload 可继续，helper 改变时当前 Run 拒绝且新 Run 可采用新版本；
5. 验证正常 locator 清理、可信陈旧 locator 清理、活动 plugin root 消失及插件目录移除后的数据告知；
6. 证明所有失败路径不写入 prompt、不创建伪完整档案，也不自动联网、编译、删除数据或绕过系统策略。

## Comments

- 2026-09-20：根据 Claude Code `2.1.278` 真人验收修订版本契约：`2.1.273` 从精确锁定改为最低兼容版本，运行时接受严格三段版本 `>=2.1.273`；更高版本仍须通过其余能力与制品探针。
