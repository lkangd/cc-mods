# 34: 发布 0.1.2

**What to build:** 31–33 号票合入 main 后，以 0.1.2 发布 chat-toc。

**Blocked by:** 31、32、33

**Status:** ready-for-agent

## 已定的决定（2026-10-12 grilling）

- 31–33 每张票一个分支（`chat-toc/3x-…`），测试先行，`--no-ff` 合入 main。
- 三张都合入后发 0.1.2，按 README 的「发布清单」：2.1.287 与当前版本跑完整门禁（MUST 由 33 项增至 37 项：`CT-LIFE-007`、`CT-LIFE-008`、`CT-JUMP-005`、`CT-UI-005`，另修订 `CT-LIFE-004`）、marketplace 冒烟、GitHub 安装检查。
- 推送前先问使用者。
- PTY 验收与性能测试串行跑，在机器空闲时跑。

## 步骤

- [x] `release_gate.py` 的 MUST 表与签字说明加入新增项
- [x] 门禁（证据目录 `mods/chat-toc/tests/evidence/0.1.2/`）
- [x] 发布提交（marketplace 版本、根 README、证据目录）
- [ ] 经使用者同意后推送，从 GitHub 做安装级检查

## Comments
- 2026-10-12 门禁（被测提交 `4926422`，两版串行，`release_gate.py run --screens`）：除 perf-many 外全部通过（37 个 MUST、validate、test 251、单元 43、两版 tsc、本地 marketplace 冒烟、签字截屏）。perf-many 两版各有一次运行的「增量读取 ≤ 150 ms」超标（2.1.287 166 ms、2.1.295 275 ms），中位数 17–30 ms 与 0.1.1 相同；当时 load average 10–11.5，另有一个 `xctest` 占约 94% CPU。失败的 perf 运行挪到 scratchpad 的 `gate-attempt1/`。
- 第二轮（`--only-perf`，load 6–7）：2.1.287 两种 perf 通过（many 增量读取最大 111–123 ms）；2.1.295 的 perf-many 在 pyte 内部崩溃（`screens.py` `render` 的 `IndexError`，驱动问题，没有产出记录），挪到 `gate-attempt2/`。
- 第三轮（2.1.295 `--only-perf`，load 4–6）：两种 perf 通过（many 最大 67–128 ms）。`release_gate.py` 已改为部分重跑时合并 `codes.json`，不再需要按日志重建。`report`：114 条记录全部通过，缺失 0，泄漏 0。
