---
id: run-identity-staleness-under-live-module
status: open
severity: major
found: 2026-09-22
source: /code-review, round 1
target: Prompt Trail uncommitted working tree, Issue 14 Run collection mode
---

# Run collection mode can act on a stale Run identity while the module stays loaded

## Problem

Every Run-scoped decision reads `startup.runId`, which is only refreshed by
`inspectTarget()`. Two paths act on it without refreshing first:

- `mods/prompt-trail/hooks/register.tsx` `disableCollection()` calls `prepareProject()` and
  `loadRunMode()` and then appends the stop boundary using the cached `startup.runId` /
  `startup.sessionId`, with no `refreshStartup($)` in between (`enableCollection()` does
  refresh).
- The `prompt.submit` hook decides the disabled fast path from `loadRunMode()` and returns
  `next(e)` *before* it reaches `startup = await inspectTarget(...)`.

If the locator's `runId` were to change while this module instance stays loaded, the cached
`runMode` (keyed `prompt-trail:run-mode:<projectId>:<runId>`) would be applied to the wrong
Run: a disabled previous Run could suppress collection in a new Run, or a boundary could be
written under the old Run id.

## Why deferred

The trigger is excluded by a design decision that belongs to a different ticket. Per
`.scratch/prompt-trail/spec.md` §6, Run identity is "随机 Run UUID 与实际宿主进程世代的组合",
a module reload does not create a new Run, and a new Run means a new process and therefore a
new module instance. Under that rule `startup.runId` cannot change beneath a live module.
Nothing in this round proves the rule holds in practice, and proving it is exactly the scope
of `.scratch/prompt-trail/issues/17-run-identity-reload-restart.md`.

## Suggested fix approach

Handle it inside Issue 17 rather than as a patch here:

1. Decide whether `runId` is observably stable across `/clear`, plugin reload, resume and fork
   for one module instance, and pin that with tests.
2. If it is not stable, invalidate the `runMode` module cache (and `timeline`) whenever the
   observed `runId` changes — the same way `prepareProject()` already resets `runMode` when the
   project id changes (`register.tsx`, the `runMode = undefined` line).
3. Consider refreshing startup before any boundary write, but keep `disable` working on an
   unhealthy target: stopping collection must never depend on a healthy preflight.

"Done" is a test that changes the locator's `runId` mid-session and shows the previous Run's
switch is not applied to the new Run.

## Recommended tools

- `grep -n 'startup.runId\|runModeKey\|refreshStartup' mods/prompt-trail/hooks/register.tsx`
- `mods/prompt-trail/tests/startup.test.tsx` already rotates `activeSessionId` mid-test; the
  same shape can rotate `runId` in the locator mock in `tests/support.tsx`.
- `npx -y @anthropic-ai/claude-code@2.1.278 plugin test mods/prompt-trail`
