---
id: damaged-generation-travels-in-a-global
status: open
severity: minor
found: 2026-09-28
source: /code-review, round 1
target: Issue 28 archive quarantine, commits 59362cc..35e5abe
---

# 损坏的 generation 经模块全局变量传给故障记录

## Problem

`mods/prompt-trail/hooks/register.tsx` 的 `safeCategory` 解析 helper 的错误时，把 `archive-integrity` 带的 `generation` 写进模块级变量 `damagedGeneration`，自己只返回类别字符串；之后由 `markUnavailable` 和 `answerDamage` 去读这个全局变量。generation 从哪一次失败来，只能靠副作用隐式维持。以后改动出错路径的人，得记得让它和 `Unavailable.generation` 保持同步；如果在读取之前又解析了别的错误，还会被覆盖成 `undefined`。

## Why deferred

要改成显式传递，得改十来处 `throw new Error(safeCategory(...))`，以及 `failureCategory`/`markUnavailable` 的签名，超出 Issue 28 的审查范围。现有路径都有测试，行为正确。

## Suggested fix approach

新增一个带类型的 helper 错误，例如 `class HelperFailure extends Error { generation?: string }`，由 `helperFailure(stderr, fallback)` 构造，替换各处的 `new Error(safeCategory(...))`；`markUnavailable` 增加一个可选的 `generation` 参数，由调用方从错误上取出后传入；删掉 `damagedGeneration`。完成的标志：`grep damagedGeneration` 没有结果，`tests/quarantine_archive.test.tsx` 全部通过。

## Recommended tools

`grep -n "safeCategory(\|damagedGeneration\|markUnavailable(" mods/prompt-trail/hooks/register.tsx`；验证跑 `npx -y @anthropic-ai/claude-code@2.1.283 plugin test mods/prompt-trail`。
