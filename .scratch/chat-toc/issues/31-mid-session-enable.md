# 31: Enabled mid-session, the contents list the conversation at once

**What to build:** Enable chat-toc in a session that is already running (no restart), and the Pane lists the conversation the session already has when it pops up, instead of staying blank.

**Blocked by:** none

**Status:** done

## Problem

The user reported: after enabling chat-toc in a running session, the right-hand Pane pops up but is empty, and the session has to be restarted before it has any content.

The cause: the transcript path is taken only from `classic.SessionStart` (`register.tsx`). On a mid-session load the host fires only `session.start` (debug log: `session.start: raised for chat-toc (loaded later)`), so the path stays `''`, `load` returns at once, `source` stays at `unknown`, and the pane has neither entries nor a note. Submitting the next message does not recover it either: chat-toc does not read the path that `classic.UserPromptSubmit` brings.

## Decisions made (grilling, 2026-10-12)

- On `session.start`, work out the path: `$.session.id()` (the transcript file name) + `$.session.cwd()` + the config directory (`$.env.get('CLAUDE_CONFIG_DIR')`, or `HOME/.claude` when it is absent; `USERPROFILE` on Windows), then read at once.
- The directory name copies the host's rule (read out of the binaries of both versions and measured): each UTF-16 unit matching `[^a-zA-Z0-9]` becomes `-`; when the result is longer than 200 characters, take the first 200 and append `-` + `Math.abs(javaHash(cwd)).toString(36)`, where `javaHash` is `e=(e<<5)-e+charCode|0`. This relies on a rule the host has not published; the user accepts the risk; no `find` search.
- After that, when a `transcript_path` from any classic hook (`SessionStart`, `UserPromptSubmit` and so on) differs from the current one, that one wins, and the file is re-read from the start after `forget()`.
- When the path cannot be worked out, the Pane shows one line, "The contents appear after the next message", and waits for a classic hook to supply the path.
- When the worked-out path's file does not exist, handle it as the existing "new session has no file yet" case.

## Steps

- [x] Test first: the pure function that works out the directory name (short path, Chinese and spaces, a non-ASCII path over 200 characters; the expected values come from the spike's `sanitize.py` measurements)
- [x] Test first: with no classic path on `session.start`, read the contents from the worked-out path; when a classic path differs, switch to it and re-read; when nothing can be worked out, show the fallback text
- [x] Implement
- [x] The acceptance contract gains `CT-LIFE-007` (`CT-LIFE-006` is taken by hot reload): both ways of enabling, the `/plugin` screen (it reloads automatically when the menu closes) and `claude plugin enable` plus `/reload-plugins`, list the existing conversation without a restart; PTY acceptance on the host's two versions
- [x] Update `docs/agents/mod-host-gotchas.md`: a mid-session load fires only `session.start`; `$.session.id()` is the file name; the directory name rule

## Comments

- 2026-10-12 spike (the two versions behave the same; evidence in `spike/runs/A*` in the scratchpad of that time): `$.session.id()`, `cwd()`, `root()` and `$.env.get('CLAUDE_CONFIG_DIR')` are all usable; `classic.UserPromptSubmit` carries `transcript_path`; `classic.Stop` does not fire in a world that is not logged in, unconfirmed.
- 2026-10-12 implementation (branch `chat-toc/31-mid-session-enable`): `hooks/locate.ts` works out the path, and `session.start` calls it when no path is known; when the path from `classic.SessionStart` or `classic.UserPromptSubmit` differs, it replaces the current one and the file is re-read from the start; when `load` finishes reading and finds the path has changed, it drops the result. `classic.Stop` is not wired (it is unconfirmed whether it carries the path, and `UserPromptSubmit` is enough). PTY: `tests/acceptance/ct_mid_session.py` passes on 2.1.287 and 2.1.295 for both enabling ways, cli and ui; the same script fails against 0.1.1's code (the control). After a CLI enable, wait for the host's settings listener to take effect (debug log `Settings changed from userSettings`) before `/reload-plugins`, otherwise the reload still treats it as disabled.
