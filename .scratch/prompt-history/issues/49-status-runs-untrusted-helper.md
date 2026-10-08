# 49: helper 不可用时 status 仍执行 helper

**What to build:** Issue 39 的 PTY 探测发现：插件判定 helper 不可用（`support: helper unavailable`）之后，`/prompt-history status` 仍会执行 locator 里的 helper，调用 `archive-status`，并列出 pending（`capture-list`）。实测做法：把插件副本里的 helper 换成符号链接，指向一个记录调用参数后再转交给真 helper 的包装脚本。bridge 判为 `helper-not-regular`，status 报 helper unavailable，但包装脚本被宿主进程调用了两次。

`hooks/register.tsx` 的 status 只在 `unsupported target` 时跳过档案查询；提交、band、清除等其他路径都要求 `support === 'supported'`。所以只要执行一次 status，摘要不符、组可写或被换成符号链接的 helper 就会被执行，违背「执行前拒绝」和「不静默更换 binary」（PH-COMPAT-003）。40 的 `fault_tour` 没发现这个问题，因为它换上的假 helper 只会 `exit 1`，执行了也看不出来。

**Blocked by:** —

**Status:** resolved

- [x] 先写 plugin test，在原代码上确认变红：helper 不可用时（locator 的 `artifactStatus` 不是 `trusted`），status 不执行 helper。
- [x] status 仍报告 consent、Run 模式与 lifecycle（来自 `$.store`），只有目标受支持时才调用 helper；不可用时 `archive:` 仍为 `unknown`。
- [x] PTY：Issue 39 的 PH-COMPAT-003 用带日志的包装脚本证明 helper 从未被执行；PH-SEC-004 也加上这条断言。

## Answer

- **修复**（`hooks/register.tsx`）：
  - status 仍从 `$.store` 读取 consent、Run 模式与 lifecycle；`archive-status`、清除清单和 pending 列表只在 `support === 'supported'` 时才向 helper 查询。
  - helper 不可用或目标不受支持时，`pending reconciliation:` 写 `unknown · <support>，无法检查档案`，不再写 `none`。与 Issue 48 的 `archive:` 行一致。
- **plugin test**：`startup_refusal.test.tsx::status runs no helper it cannot trust, even for a project that collects`。已同意采集的项目、helper 摘要不符时执行 status，断言没有任何进程调用以 helper 为 argv[0]，并且 `pending reconciliation: unknown`。它在原代码上变红，报出的正是 PTY 里看到的 `archive-status` 与 `capture-list`。
  - 原有的「before execution」断言空过：`startup_refusal` 的替身没有 mock git，`prepareProject` 抛错，走不到调用 helper 的那一步。新测试用 `support.tsx` 的完整替身。
- **PTY**：
  - PH-COMPAT-003 的每一项都换上会记录调用、再转交真 helper 的包装脚本（缺失那一项除外），断言它从未执行；在修复前的插件上，这个场景会失败。
  - PH-COMPAT-005 与 `fault_tour()`（PH-SEC-002/004、PH-FAIL-006）也用这个包装脚本，PH-SEC-004 断言它从未执行。
