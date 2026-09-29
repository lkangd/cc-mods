# 36: 以真实 PTY 证明生命周期与 Run 身份场景

**What to build:** 在 Issue 31 的 PTY 驱动器与场景清单上，为 `PT-LIFE-001..004` 与 `PT-STORE-001` 编写自动化 PTY 场景，使它们在 `2.1.273` 与当前发布验收版本上都产出可复核证据。

**Blocked by:** 31「生成零跳过发布证据」

**Status:** ready-for-agent

- [ ] `/clear`、compaction、plugin reload、正常退出与普通重启、重启延续各有 PTY 场景，断言只依据屏幕快照与 semantic verifier。
- [ ] 每个场景在隔离环境中运行，使用合成标记，trace 写盘前脱敏。
- [ ] 场景清单引用新 PTY 脚本，报告中这些场景在两个版本上都判为 pass。

## Comments

### 实现层面对齐（2026-09-29）

使用者对 Q1–Q11 回复「均采用」。

- **Q1 选中位置（PT-LIFE-003）**：先用 PTY 探测宿主在 reload 后是否保留焦点环，再定。探测结果见 Q11。
- **Q2 场景切分**：一个 ID 对应一个场景函数，每个场景用全新的 Environment；「退出再启动」抽成 `Context` 上的方法共用。
- **Q3 STORE-001 的 resume**：退出后做一次 `--resume <原 session>`，只断言 Run id 与原 Run 相同、出现「Run 续接」边界、sequence 延续。分支语义归 37。
- **Q4 断言来源**：Run 同时比 status 的 `run:` 行与档案条目的 `runId`；generation 只比 status 的 `Archive generation:` 行（档案里没有 generation 列）；consent 延续的依据是重启后提交不再弹同意问题，且 status 显示 granted。
- **Q5 正常退出**：只用 `/exit`。其他 SessionEnd reason 由 plugin test 与静态检查承担。
- **Q6 LIFE-001**：PTY 断言恰好一个 clear 边界、Run 不变、前后条目分属不同 segment、后一个开新根分支，band 显示「/clear：新的 Conversation Segment」。重复事件与两事件间崩溃由清单中已有的 plugin/unit 证据承担。
- **Q7 LIFE-002**：compact 后的条目与前一个条目 `branchId`、`segmentId` 相同，`parentEventId` 指向前一个条目；没有 clear 边界，也没有新 Run；band 里两条都不带 `×`。
- **Q8 LIFE-003**：reload 前后条目数不变，band 里该条目只出现一次且不带 `×`，展开状态保持，status 的 `run:` 不变。
- **Q9 LIFE-004**：重启后展开 band，旧条目带 `×`，能看到「Run 离开」与新的「Run 开始」；status 的 `run:` 与旧 Run 不同，`Archive generation` 相同。
- **Q10 验证**：用 scratchpad 脚本调试单个场景；收尾时在两个版本上跑 `release-evidence.sh --skip-gates --only <5 个 ID>`，再跑 `verify-startup.sh`。不做完整运行（归 41）。变异检查只在 2.1.283 上做，每个场景反转一条关键断言。
- **Q11 选中位置的定义**：探测（2.1.283）表明，不经过 reload 焦点环也留不住：进入 band 后焦点落在最新条目，↑ 移到上一条，Esc 离开后再按 `ctrl+x tab`，又回到最新条目；reload 之后也一样。插件把 `autoFocus` 固定给最新条目，而 `/reload-plugins` 必须在输入框里执行，执行前焦点已经离开 band。据此修订契约：焦点离开 band 后不保留选中位置，reload 后与 Esc 后一样从最新条目开始；reload 要保证的是展开状态、条目与 Jump Target。PT-LIFE-003 的 expected、Issue 05 的契约条目与 README 的不承诺清单同步修订，PTY 断言 reload 后 `ctrl+x tab` 落在最新条目。
