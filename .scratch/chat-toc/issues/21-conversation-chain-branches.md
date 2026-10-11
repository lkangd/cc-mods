# 21: 对话链：compact、rewind、resume、fork

**What to build:** 目录始终只反映当前分支：compact 之前的条目照常显示，rewind 后的下一次提交让被弃分支从目录消失，resume、fork 之后目录与该会话文件的对话链一致；两个终端里同一项目的两个会话各自只显示自己的目录。

规格见 [chat-toc MVP](../spec.md) §3（对话链）、§4（生命周期）。

**Blocked by:** 18（独立 verifier 与 PTY 验收驱动）、19（完整的开组规则与 Agent reply）

**Status:** resolved

- [x] 沿 `parentUuid` 回溯，遇到 `system/compact_boundary` 改沿 `logicalParentUuid`；compact 前的条目照常显示（CT-LIFE-003）
- [x] rewind（含 Esc Esc）后的下一次提交，被弃分支的条目消失（CT-LIFE-004）；提交之前的窗口里旧条目仍在，符合不承诺清单
- [x] `--resume`、`--continue`、会话内 `/resume`、`--fork-session` 之后，verifier 比对目录与对话链一致（CT-LIFE-005）
- [x] 两个终端里同一项目的两个会话，各自只显示自己的 transcript（CT-DATA-006）
- [x] 判据一律是独立 verifier；以上场景在两个版本上通过

## Comments

- 2026-10-11 实现：`hooks/chain.ts` 的 `parentOf` 在 `system/compact_boundary`（`parentUuid` 为空）处改沿 `logicalParentUuid`；增量重组沿用同一个 `parentOf`，`tests/incremental_regroup.test.ts` 的随机会话加入了 compact，逐片读取仍与整份重组一致。本机 2.1.195～2.1.295 的真实 transcript 里所有 compact 边界都是 `parentUuid: null` + `logicalParentUuid`，`preservedSegment` 指向边界之前已有的行，沿 `logicalParentUuid` 回溯自然经过它们，不会重复。
- PTY 验收脚本 `mods/chat-toc/tests/acceptance/chain_scenarios.py`，判据全部是 `toc_verifier`；2.1.287 与 2.1.295 各 6 个场景全部通过（CT-LIFE-003 两次 compact + 弃枝、CT-LIFE-004 Esc Esc rewind 后提交、CT-LIFE-005 `--continue` / `--fork-session` / 会话内 `/resume`、CT-DATA-006 两个终端；`--resume` 由前两个场景覆盖）。验收世界不登录：提交的 prompt 会写进 transcript，宿主自己回一行「Not logged in」，所以 rewind 后提交、fork 后提交都不调用模型。
- compact 用的是合成的边界行（形状与真实一致），没有跑真实 `/compact`（要调用模型）。
- `--fork-session` 在第一次提交之前，新会话的文件还不存在：目录与文件一致（都空），但 Pane 显示「本会话还没有对话」，而左侧 transcript 里有分叉来的历史，这句话会误导。第一次提交后宿主才写文件，且只写它内存里的那段（最后一次 compact 之后），目录随之与文件一致。改这句空状态文字属于 Pane 生命周期（20 号），留给它决定，例如 `SessionStart` 的 `source` 为 `resume`/`fork` 而文件不存在时换一句说明。
- `forms` fixture 的 smoke 现在 compact 前的组都显示；剩下的不一致只有 F02 一条（`hooks/cells.ts` 把 ✨ 算 1 格，见 pty-harness 笔记），与对话链无关。
