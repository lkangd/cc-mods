---
id: new-generation-root-before-first-capture
status: open
severity: minor
found: 2026-09-28
source: /code-review, round 1
target: Issue 28 archive quarantine, commits 59362cc..35e5abe
---

# 新 generation 的根分支在第一次预写前没有绑定 generation

## Problem

`mods/prompt-trail/hooks/register.tsx` 的 `enterNewGeneration` 写完 `run-attached` 后，保存的新根分支状态只有 `explicitRoot`，没有 `generation`。紧接着的 `capture-begin` 因此以 `-` 作为预期 generation 发送，直到这次预写成功才从返回值里记下 generation。

如果另一个 Run 恰好在 `run-attached` 写入之后、这次预写之前又隔离了新 generation，这个 Run 会在第三个 generation 里继续提交，而且察觉不到 generation 又变了；它的 `run-attached` 已经随第二个 generation 被隔离，当前时间线就缺了这个 Run 的接入边界。新根没有父节点，所以不会写错父节点，只会少一行边界。

## Why deferred

需要连续两次隔离、并且第二次正好落在一个很窄的窗口里；后果只是少一行边界。要修，得让 `boundary-append` 的输出也带上 generation（或者让 `archive-generation` 错误带上当前 generation），协议改动比问题本身大。

## Suggested fix approach

让 `boundary-append` 的成功输出带上 `generation`（写法同 `capture-begin` 的 `write_pending`），`appendBoundary` 解析后返回它；`enterNewGeneration` 把这个 generation 存进新根分支状态。之后的 `capture-begin` 带着它做预检，第二次隔离就会再次触发 `archive-generation`。完成的标志：plugin test 模拟「`run-attached` 写入后 generation 再变一次」，下一次预写报 `archive-generation`，并在第三个 generation 里补写 `run-attached`。

## Recommended tools

`grep -n "enterNewGeneration\|parseBoundaryResponse" mods/prompt-trail/hooks/register.tsx`；helper 侧 `grep -n "static void boundary_append" mods/prompt-trail/src/prompt_trail_helper.c`；用 `tests/quarantine_archive.test.tsx` 里「a capture meant for a generation another Run replaced」这条测试的写法复现。
