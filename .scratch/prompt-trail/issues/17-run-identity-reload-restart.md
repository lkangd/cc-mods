# 17: 跨 reload 与重启维护 Run 身份

**What to build:** 让使用者在 plugin reload 后继续同一个 Run，在退出、重启或新进程中获得新 Run，并持续看到旧 Project Timeline，而不会因继承环境变量错误复用身份。

**Blocked by:** 12「同意采集并显示首个 Prompt Entry」

**Status:** ready-for-agent

- [ ] Run 身份由随机 Run UUID 与实际宿主进程世代共同确定，不以 module instance、classic session ID 或单独环境变量充当 Run。
- [ ] 同进程 `/reload-plugins` 产生新 module instance 但复用 Run；重放 render 不重复 Timeline Events。
- [ ] reload 后 Run collection mode、展开状态、选择位置和已持久事件保持。
- [ ] 正常退出写入 Run 结束；重新启动创建新 Run，并继续读取同一 Project Timeline 和 Archive generation。
- [ ] 异常退出留下未闭合 Run；后续浏览显示中断而不伪造结束事件。
- [ ] 继承 Run 环境标记但实际宿主进程世代不同的子进程创建新 Run。
- [ ] 一个 Run 固定使用启动时的 helper 路径、摘要和 protocol；运行中制品变化使当前 Run 停止采集，恢复原制品或新 Run 才能继续。
- [ ] 正常 SessionEnd 清理当前 session locator；重启不会复用旧 locator。
- [ ] 旧 Prompt Entries 在普通新 Run 中继续可见，但不得凭持久数据伪造 Jump Target。
- [ ] plugin test、helper semantic test 与真实 PTY 覆盖 reload、正常退出、异常退出、重启、继承环境和 helper 变化。
