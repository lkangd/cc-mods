# CT-PERF-001 结果（27 号票，供 29 号贴进 `tests/evidence/0.1.0/report.md`）

> 29 号发布时：把下面「结果表」和「说明」贴进 report.md 的 CT-PERF-001 一节；如果发布前插件代码又动过读取、重组、Pane 或 Current position，按「怎么重跑」在发布提交上重跑一遍，换掉数字和被测提交。本文件随发布提交删掉或留作底稿均可。

- 被测提交：`89351b1`（分支 `chat-toc/27-perf`；插件代码与发布前的 `chat-toc/mvp` 合并结果相同，见 27 号票 Comments）。
- 参考机器：macOS（Darwin 24.6.0），arm64，Apple M1 Pro，32 GB。只是样本，不是对所有硬件的承诺（规格 §9、已知限制）。
- Claude Code：2.1.287（npm 临时目录，不碰全局安装）与 2.1.295（当时的当前版本）。
- fixture：ticket 18 的 `transcript_fixture.py`，固定种子。`many` 20 MiB、4521 轮、25,680 行；`heavy` 20 MiB、107 轮、7,704 行（每轮 14 个工具结果 2–60 KB 加 attachment 行）。生成器现在的轮数与规格 §9 写的 4432/111 略有出入，是 18 号生成器的行形状与 12 号探针不同所致，量级相同。
- 每个版本、每种 fixture 跑 3 次，按规格取 p95：按次计的项（首次出目录、整份读取）取 3 次中的最大值；按样本计的项取每次运行的 p95，再取 3 次中最大的那个。

## 结果表

| 项 | 阈值 | 2.1.287 many | 2.1.287 heavy | 2.1.295 many | 2.1.295 heavy |
|---|---|---|---|---|---|
| 首次出目录：TOC 比宿主 transcript 显示末轮晚 | ≤ 4 s | 0.73 s | 0.54 s | 0.77 s | 0.53 s |
| 启动时首次整份读取加重组（与宿主 resume 争抢，参考） | — | 330 ms | 234 ms | 353 ms | 225 ms |
| 空闲时整份读取加重组（热重载后） | ≤ 1 s | 371 ms | 195 ms | 375 ms | 205 ms |
| 增量读取，单次 | ≤ 150 ms | 111 ms | 26 ms | 104 ms | 38 ms |
| 追加一行到目录模型更新 | ≤ 1 s | 514 ms | 347 ms | 490 ms | 369 ms |
| Pane 重画，插件自身计算 | ≤ 16 ms | 0.38 ms | 0.38 ms | 0.36 ms | 0.37 ms |
| Pane 重画，含等宿主 | ≤ 100 ms | 2.3 ms | 8.5 ms | 1.9 ms | 8.7 ms |
| Current position 每次计算 | ≤ 2 ms | 0.03 ms | 0.02 ms | 0.03 ms | 0.02 ms |
| Current position，3000 条残留在屏记录（见说明 4） | ≤ 5 ms | 0.33 ms | — | 0.34 ms | — |
| 长会话连续滚动、跳转到首组和末组 | 必须能到达，不分页 | 是 | 是 | 是 | 是 |
| 运行次数（通过） | 3 | 3（3） | 3（3） | 3（3） | 3（3） |

结论：两个版本、两种 fixture、共 12 次运行，CT-PERF-001 全部通过。

## 说明

1. **怎么量的**。`tests/acceptance/perf_scenarios.py`：每次在 harness 的隔离环境里生成新的 20 MiB fixture，pyte 170×44 全屏 `--resume`，不登录、不调用模型，设 `CHAT_TOC_PERF=1`。插件把各段耗时（只有毫秒数与计数，没有 prompt、uuid、路径；CT-SEC-001）写进宿主的 `--debug-file`，脚本读回。「首次出目录」由脚本读屏：宿主 transcript 出现末轮文字的时刻与 Pane 列出条目的时刻之差。每次运行依次：冷启动 resume；transcript 上下各滚 150 格、Pane 上滚 100 下滚 60；Pane 一路滚到顶并点 T0000（到达首组）；transcript 从顶快速下滚 1500 格（留下残留在屏记录）；Pane 一路滚到底并点最新一条（到达末组）；热重载插件（空闲时整份读取加重组）；不登录状态下提交 5 条合成 prompt（宿主写 prompt 行与「Not logged in」行并触发 `session.append`：增量读取、追加到模型更新）。
2. **连续滚动不分页**。many 的 Pane 从底滚到顶用了 9,120–10,000 格滚轮、84–103 s，从首组滚回末组 7,480–8,180 格；中途没有分页，每格挪一条左右。两版点首组都把 T0000 的 prompt 放到 transcript 顶部，点末组都显示末轮。
3. **Pane 重画**。条目按组缓存（`hooks/table.ts`），只有数据、宽度、View filter、Layout 或进行中的轮变化时才重建条目表，文件只增长时只重排末尾几组。p95 都在 0.4 ms 以内；每次运行里最长的一次是读完文件后的第一次绘制（整张表第一次建）：many 55–61 ms、heavy 3–7 ms。「含等宿主」的 p95 主要是 `read`、`$.clock.now` 的往返。
4. **3000 条残留在屏记录**。真实操作留不下这么多：ticket 24 记下的「长距离滚动后残留累积」在这里实测最多 30 条（many，含 1500 格快速滚动）、11 条（heavy）。所以这一项在插件的运行环境里合成（`tests/long_session.test.ts`，`claude plugin test` 与 `<2.1.287>/claude plugin test` 都跑，单独运行该文件各 3 次）：many 形状的 4432 轮、26,590 行对话链，3000 条散在全会话的过期记录加 12 条真在屏的记录，每次计算 p50 0.27–0.29 ms、p95 0.31–0.34 ms、最大 1.1–1.5 ms，算出的组与没有残留时相同。没有残留时 p95 0.005–0.009 ms。因此 24 号的 O(n log n) 重算不需要改。
5. **增量读取的长尾**。many 每次运行的 p95 都来自热重载后的第一次提交：那一次 104–111 ms 里约 100 ms 花在读文件那一步（新模块第一次 `$.process.run` 分块读），重组只占几毫秒（诊断运行 `20261011-145755` 记了分段：取文本 102 ms，整段 108 ms，只续接末组）。其余单次 5–50 ms。
6. **追加到模型更新**约 330–510 ms，主要是规格定的 300 ms 尾随节流（§3）。
7. 「启动时首次整份读取」与宿主 resume 同时进行，只作参考，阈值看「首次出目录」。

## 证据

- 运行目录（不含 debug 日志，日志里有宿主自己的行，体积大）：`.scratch/chat-toc/assets/27-perf/runs/`
  - `20261011-144313-ct-perf-2.1.287-many`、`20261011-145334-ct-perf-2.1.287-heavy`、`20261011-143107-ct-perf-2.1.295-many`、`20261011-144113-ct-perf-2.1.295-heavy`：各含 `run.jsonl`（每次运行一条 CT-PERF-001 记录）、`perf-samples-*.json`（全部样本）、`screens/`（到达首组、末组的截屏）。
  - `20261011-145755-ct-perf-2.1.295-many`：诊断运行（读取样本多记了取文本耗时与重组方式），不计入表。
- 拷贝时核对过：debug 日志里每一行 `chat-toc-perf` 的内容都只有指标名和数字。

## 怎么重跑

```sh
PY=<装了 pyte 的 venv>/bin/python
for host in 2.1.287 current; do for kind in many heavy; do
  $PY mods/chat-toc/tests/acceptance/perf_scenarios.py run $host $kind --runs 3
done; done
$PY mods/chat-toc/tests/acceptance/perf_scenarios.py table mods/chat-toc/build/pty-runs/<四个运行目录>
claude plugin test mods/chat-toc 2>&1 | grep CT-PERF        # 3000 条残留、条目表（套件并行时数字偏大，单独跑该文件更准）
```

整套约 35 分钟（many 每次约 4 分钟，大部分是一格一格把 Pane 滚到顶再滚回底）。
