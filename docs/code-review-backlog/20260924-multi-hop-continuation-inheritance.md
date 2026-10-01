---
id: multi-hop-continuation-inheritance
status: open
severity: major
found: 2026-09-24
source: /code-review, round 1
target: Prompt Trail uncommitted working tree, Issue 33 continued session keeps its Run and Active Branch
---

# 连续接续时，中间 session 没提交过，就继承不到分支与 compacted 状态

## Problem

`mods/prompt-trail/hooks/register.tsx` 的 `branchState()` 在本 session 没有分支记录时，只读
`startup.continuedFrom`（直接来源）的分支键；`sessionCompacted()` 也只看直接来源的 compacted
键。插件只有在采集、写边界时才会给一个 session 写这两个键。

（2026-10-01 更新）Issue 34 之后，`sessionCompacted()` 还会认 transcript 开头的 compact 摘要。
接续用的是 `--resume <旧 transcript> --fork-session`，Issue 34 的探针证明这样得到的 transcript 以摘要开头，
所以 C 的 compacted 状态不再依赖 B 的键，这里只剩分支记录的继承缺口。这一点只是推断，没有在连续接续上实测过：
宿主目前造不出这样的链。

场景：A 已 `/compact`，接续到 B，B 从未提交；B 再接续到 C。B 没有分支键，也没有 compacted
键，C 只查 B，于是新建 `parentEventId: null` 的分支，并把 compact 过的 transcript 当作没
compact 过。C 的第一次提交得到 `none`，按 `settleBranch()` 的「尚无 lineage」规则静默开根
（`hooks/branch.ts:61-70`），而不是请使用者确认父节点，与 A 的链接就此丢失。

bridge 这一侧没问题：`handed_off_chain()` 会沿会话索引逐级回溯，C 仍然沿用 A 的 Run。

## Why deferred

2.1.281 的真人 PTY 表明，当前宿主造不出这样的链：已经在后台进程（daemon 的 `bg-spare`）里的
session 再转到后台，只会把界面脱开，不会生成新 session，也不会写 `continued-in`（见 Issue 33
Comments「PTY 第一轮」③）。修复要让 locator 携带整条链，改动横跨 C、locator 解析和插件，
而且没有办法做 PTY 验证。使用者选择放进 backlog。

## Suggested fix approach

- bridge：接续 session 发布 locator 时，把 `handed_off_chain()` 求得的链（最多 32 个，
  直接来源排在最前）写进一个可选数组字段，例如 `continuedChain`，每次发布该 session 的
  locator（包括 resume）都带上。`locatorVersion` 是否要升，届时再定。
- 插件：`parseLocator` 逐项校验这个数组（都是安全标识符、不含本 session、不重复），否则按
  `locator-identifiers` fail closed。`branchState()` 沿链找第一个有分支记录的 session；
  `sessionCompacted()` 沿链看是否有任何一个 session 的 compacted 键为 true。命中后回填本
  session 的键。
- 测试：`tests/continued_session.test.tsx` 加 A（compacted、有分支）→ B（无记录）→ C 的用例，
  断言 C 的首次提交弹出「确认父节点」，R2 排第一；`tests/bridge_protocol.py` 断言两跳后
  locator 里的链。

## Recommended tools

- `grep -n "continuedFrom" mods/prompt-trail/hooks/register.tsx mods/prompt-trail/src/prompt_trail_bridge.c`
- `handed_off_chain`、`read_session_index`（bridge），`branchState`、`sessionCompacted`、`parseLocator`（插件）
- `mods/prompt-trail/scripts/verify-startup.sh`
- 等宿主重新能产生连续接续时，再补真人 PTY。
