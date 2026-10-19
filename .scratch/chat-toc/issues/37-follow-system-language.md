# 37: Words follow the system language

**What to build:** chat-toc's words were Chinese only. The user decided (2026-10-14) that everything tracked in the repository is English, and that the mod's on-screen words follow the system language: Chinese when the locale says Chinese, English otherwise.

**Blocked by:** none

**Status:** done

## Decisions

- **Which language**: the first set of `LC_ALL`, `LC_MESSAGES`, `LANG` (POSIX order); `zh` at its start (`zh`, `zh_CN.UTF-8`, `zh-Hans`, `zh_TW`) is Chinese, anything else or nothing set is English. The host has no locale API (checked in the 2.1.295 type declarations), so the variables are the only signal. The user's own machine has `LANG=en_US.UTF-8` and English first in macOS's languages, so it shows English.
- **When**: once a load, at the first start event (`session.start` or `classic.SessionStart`), before the command is registered or anything is drawn. A hot reload asks again.
- **Where**: `hooks/text.ts` holds both word tables and `languageOf`; every module reads `text`, swapped in place by `setLanguage`. `register.tsx` reads the variables (`$.env.get` needs literal names).
- **English words**: Contents, All / User / Agent, Card / Compact / Timeline, `Layout: Card`, `N steps`, `N turns` (1 step, 1 turn), Running / Interrupted / Error, No text reply, (image only), `Oct 9`, `Today · Oct 9`, `Oct 9, 2025`, `⏸ Not following`, and full sentences for the notices and status lines (table in `hooks/text.ts`; the root README quotes them).
- **Tests**: the existing suites keep checking the Chinese words: `tests/host.ts` starts worlds with `LANG=zh_CN.UTF-8`, pure tests call `setLanguage('zh')`, and the PTY worlds set `LC_MESSAGES=zh_CN.UTF-8`. `tests/language.test.ts` covers the language choice and the English words on the terminal and the desktop.

## Acceptance criteria

- [x] With `LANG=en_US.UTF-8` (or nothing set) the pane title, filters, Layout button, steps, day rule, turn count, status lines and desktop labels are English.
- [x] With a Chinese locale they are the Chinese words of 0.1.3, unchanged.
- [x] `LC_ALL` wins over `LC_MESSAGES` over `LANG`.
- [x] `claude plugin test` 280/280, `tsc` clean, `claude plugin validate` passes, the acceptance tools' unit tests 49/49.

## Not done

- No PTY scenario runs in English; the English words are covered by unit tests only (written into the README's known limits). A release (0.1.4) should decide whether to add English PTY runs.
- The English words have not been seen in a real terminal or in the Claude app yet.

## Comments

- 2026-10-14: the same change translated every tracked document into English (READMEs, spec, map, tickets, the release report generator); release evidence and probe captures stay as recorded (AGENTS.md, Language).
