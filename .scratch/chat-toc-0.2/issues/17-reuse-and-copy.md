# 17: Reuse and copy on the terminal

**What to build:** Buttons on the preview's label rows that act on the group it shows: `r: Reuse` fills the User input into the composer as a draft (replacing an empty composer, appending after a draft, never submitting), `c: Copy` copies it, `a: Copy` copies the last text.

Spec: [chat-toc 0.2](../spec.md) §7.

**Blocked by:** 13 (The preview region on the terminal)

**Status:** resolved

- [x] `User    r: Reuse · c: Copy` / `用户    r: 填入 · c: 复制` and `Agent    a: Copy` / `Agent    a: 复制` on the label rows; fit 36 columns in both languages (record what gives way if they do not)
- [x] Reuse reads `$.prompt.read()`: empty → `replace`; a draft → `append` after a blank line; never submits; works while a turn runs
- [x] Text rules: as typed (§4), `/name args`, no `r` for a `!cmd` (its `c` copies `!cmd`), neither for image-only, text-only with the `Images not included` / `图片未包含` toast, no `a` for a running group; the last text as its Markdown source
- [x] Feedback: no toast on a filled prompt; the two fill-failure toasts; `Copied` / `已复制` on the Button for about 2 s; a toast with the reason on `isCopied: false`
- [x] No hotkey works with the preview hidden; `a` goes when the cut preview drops the `Agent` label row
- [x] Nothing kept: the text is read from the transcript at the press
- [x] `CT-REUSE-001` added to the PTY drivers and the release gate's MUST list, passing on both versions (restore the clipboard afterwards, as ticket 02's driver does); `CT-SEC-001` puts the marker in a reused and a copied prompt
- [x] Root README: `r`, `c`, `a` in the controls table; known limits 6 and 7 of the spec
- [x] `claude plugin test`, `tsc` and `claude plugin validate` pass

## Comments

Built on `chat-toc-0.2/17-reuse` (2026-10-16).

- Pure part in `hooks/reuse.ts` (`reusableOf`, `fillOf`, `fillRefusedText`); the Buttons are drawn by `labelRow` in `hooks/pane.tsx`, in the region and in the expanded view; `register.tsx` reads the group by its opener among the groups listed at the press.
- 36 columns: both label rows fit in both languages, `Copied` / `已复制` included (`ct_reuse.py widths`); nothing gives way.
- A fill with no `refusal` gives the "another plugin refused" toast; `no_composer` (not met on the terminal) gets its own words, `Couldn't fill the prompt: there is no prompt box here` / `无法填入：此处没有输入框`, rather than blaming a plugin. A copy refused for `no-surface` or `refused` says `Couldn't copy: no clipboard here` / `Couldn't copy: another plugin refused`.
- With the preview folded, `r`, `c` and `a` are no hotkeys, so the host types them into the composer (the host's rule for a printable key that is no hotkey); nothing is filled or copied.
- The ring moving from an entry onto the preview's own Buttons keeps the preview on that entry (before, it fell back to the Current position's group, so Enter on `r` would have acted on another turn).
- PTY: `ct_reuse.py` (`fill copy rules hidden dialog running widths`) and `gate_scenarios.py sec-001` pass on 2.1.287 and 2.1.295; `ct_preview.py` and `gate_scenarios.py ui-002` read a label row with Buttons now and pass on both.
