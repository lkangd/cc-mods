# Decide how an earlier prompt is reused

Type: grilling
Status: resolved
Blocked by: 02

## Question

How does a person take an earlier User input back to send again or keep?

- Put it in the composer as a draft, copy it to the clipboard, or both; never submit it.
- What triggers it on an entry (a key on the selected entry, a control in the preview), on the terminal and on Desktop.
- What text is reused: the original as typed (with code blocks and pasted content restored) rather than the folded line on screen; what happens for a slash command, a `!cmd`, an image-only prompt; whether the Agent reply's last text can be copied too.
- What happens when the composer holds a draft or Claude is working, and what the person is told after it worked or failed.

Settled by the preview ticket (08): the preview shows the selected group while the Pane holds the keys (else the Current position's; on Desktop the last pressed), with the User input as typed under a `User` label row and the last text under an `Agent` label row; `p` and `e` are taken. A control in the preview acts on the group it shows.

## Answer

Decided with the user on 2026-10-16. The term **Reuse** is in [`mods/chat-toc/CONTEXT.md`](../../../mods/chat-toc/CONTEXT.md).

**Three actions, all in the preview.** Reuse (fill the User input into the composer as a draft, never submitted), copy the User input, and copy the Agent reply's last text (the host's `/copy` reaches only the latest reply). They act on the group the preview shows (ticket 08). Entries carry no keys of their own.

**Where and which keys (terminal).** Buttons at the right of the preview's label rows: `User    r: Reuse · c: Copy` / `用户    r: 填入 · c: 复制`, and `Agent    a: Copy` / `Agent    a: 复制`. A hotkey hangs only on a drawn Button, so with the preview hidden (`p`) none of the three keys works, and when a short preview cuts the `Agent` label row, `a` goes with it until `e` expands it. The keys work only while the Pane holds them, which is also when the preview shows the selected group. Taken so far: 1/2/3, `l`, `p`, `f`, `e`, `r`, `c`, `a`.

**Filling.** The composer is read first (`$.prompt.read()`): empty, the text goes in with `replace`; holding a draft, with `append` after a blank line, so the person's draft is never lost and never refused. While Claude is working the fill lands as usual and Enter queues it (the host's behaviour). A fill moves the keyboard to the composer; a copy leaves it in the Pane.

**What text.**
- The User input as typed, as the preview shows it (code blocks and pasted content restored); the Agent reply's last text as its Markdown source.
- A slash command fills as `/name args`; Enter runs it, which is the person's choice.
- A `!cmd`: `r: Reuse` is not drawn (a fill cannot enter bash mode, so Enter would send it to the model); `c: Copy` copies `!cmd` as typed.
- An image-only input: neither `r` nor `c` is drawn.
- Text with images: only the text is filled or copied, and a toast says the images were not included (`Images not included` / `图片未包含`).
- A running group: `a: Copy` is not drawn (it would copy half-written text); `r` and `c` work.

**What the person is told.**
- Fill succeeded: no toast; the text in the composer and the keyboard moving there say it.
- Fill failed: a toast with the reason, `Couldn't fill the prompt: a dialog is open` / `无法填入：有对话框打开` for `refusal: 'dialog'` (the text is dropped, not deferred), `Couldn't fill the prompt: another plugin refused` / `无法填入：被其他插件拒绝` for `isFilled: false` with no refusal.
- Copy: the Button's label reads `Copied` / `已复制` for about 2 seconds. `isCopied: false` gives a toast with the reason (`Too long to copy here` / `太长，无法在此复制` for Desktop's limit). The terminal cannot confirm the clipboard got it (`isCopied` is always true there); the README's "not promised" list says so.

**Desktop.** Copy only: a `Copy` Button on each label row, without hotkeys; no Reuse, because the host answers `isFilled: true` while the text sometimes never shows in the app's composer. Reuse is turned on by `$.session.version()` once a host shows fills reliably.

**Nothing kept.** No text or id is stored; the actions read the Transcript at the press.

**Left for later.** The README's "not promised" lines (no Reuse on Desktop, no confirmed copy on the terminal, images not reused) and the `CT-*` scenarios: the spec ticket. Whether the label rows fit `r: Reuse · c: Copy` in 36 columns with the CJK words: the implementation.
