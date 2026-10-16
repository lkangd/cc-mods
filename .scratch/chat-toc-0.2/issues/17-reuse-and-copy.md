# 17: Reuse and copy on the terminal

**What to build:** Buttons on the preview's label rows that act on the group it shows: `r: Reuse` fills the User input into the composer as a draft (replacing an empty composer, appending after a draft, never submitting), `c: Copy` copies it, `a: Copy` copies the last text.

Spec: [chat-toc 0.2](../spec.md) §7.

**Blocked by:** 13 (The preview region on the terminal)

**Status:** ready-for-agent

- [ ] `User    r: Reuse · c: Copy` / `用户    r: 填入 · c: 复制` and `Agent    a: Copy` / `Agent    a: 复制` on the label rows; fit 36 columns in both languages (record what gives way if they do not)
- [ ] Reuse reads `$.prompt.read()`: empty → `replace`; a draft → `append` after a blank line; never submits; works while a turn runs
- [ ] Text rules: as typed (§4), `/name args`, no `r` for a `!cmd` (its `c` copies `!cmd`), neither for image-only, text-only with the `Images not included` / `图片未包含` toast, no `a` for a running group; the last text as its Markdown source
- [ ] Feedback: no toast on a filled prompt; the two fill-failure toasts; `Copied` / `已复制` on the Button for about 2 s; a toast with the reason on `isCopied: false`
- [ ] No hotkey works with the preview hidden; `a` goes when the cut preview drops the `Agent` label row
- [ ] Nothing kept: the text is read from the transcript at the press
- [ ] `CT-REUSE-001` added to the PTY drivers and the release gate's MUST list, passing on both versions (restore the clipboard afterwards, as ticket 02's driver does); `CT-SEC-001` puts the marker in a reused and a copied prompt
- [ ] Root README: `r`, `c`, `a` in the controls table; known limits 6 and 7 of the spec
- [ ] `claude plugin test`, `tsc` and `claude plugin validate` pass
