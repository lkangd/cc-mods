# 12: 同意采集并显示首个 Prompt Entry

**What to build:** 让首次进入一个 Project Timeline 的使用者在知情同意后提交一个简单 prompt，并在折叠时间线中看到它已经持久保存；拒绝同意时则正常继续而不建档。

**Blocked by:** 11「可信启动并报告支持状态」

**Status:** resolved

- [x] 首次 composer submission 前完成只读 preflight，并让使用者明确选择“启用”或“继续但不启用”；加载插件本身不构成 Collection consent。
- [x] consent 告知覆盖完整文本、明文本地保存、永久且无应用配额、凭据风险、数据库位置、同账户/root 信任边界及删除不覆盖的副本。
- [x] 选择继续但不启用时，本次 prompt 正常进入 Claude Code，但不创建项目数据库、Pending Capture 或 Prompt Entry。
- [x] 选择启用时，按当前规范项目根建立 Project Timeline；Git 子目录和 symlink 归一到真实根，非 Git 项目使用启动目录，只持久保存稳定项目 hash。
- [x] 每个 Project Timeline 创建独立 SQLite 数据库，prompt 数据不写入项目目录或 plugin root。
- [x] 简单 composer submission 先持久预写 Pending Capture，成功进入会话后原子确认成一个 Prompt Entry；prompt 原文只经 stdin 传给 helper。
- [x] 首个 Prompt Entry 获得唯一 event ID 和项目级 sequence，并保存完整最终文本、Run、Conversation Segment、Conversation Branch 与逻辑父关系。
- [x] Prompt Trail 默认折叠；点击标题或运行裸 `/prompt-history` 后按旧到新显示该 Prompt Entry。
- [x] consent 按 Project Timeline 与 policy version 持久保存；普通 reload 不重复询问，实质政策版本变化会暂停采集并重新询问。
- [x] semantic verifier、plugin test、helper black-box test 和真实 PTY 证明 consent 前零持久化、同意后端到端可见且诊断无原文泄漏。

## Comments

- 2026-09-21：实现首版 consent-first 采集闭环。`prompt.submit`（仅 `origin=composer`）先规范化项目根（Git toplevel，失败且能证明存在 `.git` 时失败关闭）、按稳定 hash 定位每项目 SQLite，再询问一次带策略版本的 Collection consent；拒绝时 prompt 正常进入且零建档，启用时先 `capture-begin` 预写 Pending Capture、`next(e)` 成功后 `capture-confirm` 原子确认为 Prompt Entry。prompt 原文只经 stdin 进入 helper，argv/stdout/stderr/诊断只含随机 event ID、sequence、计数与错误类别。
- 2026-09-21：按自动审查结果加固。已启用采集后，preflight 失败、目标不再受支持或项目身份无法证明一律失败关闭而不是静默放行；Archive unavailable 改为写入 `$.store`，reload 后仍然阻止提交；拒绝采集时即使 consent 写入失败也不阻塞 prompt。native 侧新增：已确认事件不可再次预写或 abort、完全相同的 `capture-begin` 重试幂等、确认时校验逻辑父节点存在且拒绝自引用、stdin 必须是不含 NUL 的合法 UTF-8。
- 2026-09-21：新增 test-only semantic verifier（`tests/semantic_verifier.py`），helper 黑盒测试改为通过它断言 pending/confirmed 语义，而不是在测试中复制生产表结构。自动门禁：Claude Code `2.1.273` 与 `2.1.278` 各 39 项 plugin tests、7 项静态/策略制品测试、13 项 bridge protocol tests、15 项 helper protocol tests、TypeScript 与确定性重建全部通过；真实 PTY 验收待人工执行。
- 2026-09-21：真人 PTY 验收通过（受支持启动、首次提交弹出同意、拒绝后 prompt 正常进入且零建档、启用后原文入档、裸 `/prompt-history` 展开可见、再次提交不重复询问、status 无原文）。验收发现展开列表沿用项目级 sequence，导致新会话从 3 开始；按使用者决定改为会话级显示序号（从 1 按显示位置编号），项目级永久 sequence 仅保留在档案内。

## Answer

Prompt Trail 现在以 consent-first 的方式采集首个 Prompt Entry：`prompt.submit(origin=composer)` 先规范化项目根并按稳定 hash 绑定每项目 SQLite，再就完整告知询问一次带 policy version 的 Collection consent；选择“继续但不启用”时 prompt 正常进入会话且不创建数据库、Pending Capture 或 Prompt Entry，选择“启用”时先预写 Pending Capture、`next(e)` 成功后原子确认为 Prompt Entry。prompt 原文只经 stdin 进入 helper，argv、stdout/stderr、locator 与诊断只含随机 event ID、sequence、计数和错误类别。consent 与 Archive unavailable 都持久化在 `$.store`，普通 reload 不重复询问也不会复活失效关闭；policy version 变化会重新询问。采集启用后，preflight 失败、目标不再受支持或项目身份无法证明一律失败关闭而非静默漏记。界面默认折叠，点击标题或裸 `/prompt-history` 展开后按旧到新显示条目，显示序号为会话级、从 1 开始。
