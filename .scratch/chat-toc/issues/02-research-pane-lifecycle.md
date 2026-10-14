# Check the docked Pane's lifecycle and placement rules

Type: research
Status: resolved
Blocked by: 

## Question

In the public mods API of Claude Code `>=2.1.287`, what exactly are the docked Pane's rules: the placement thresholds of an unasked `$.ui.open` at `session.start` (144 / 110 columns, fullscreen or not), queueing when too narrow and seating by itself later, the values of `isPlaced` and `placement`; what the mod receives when the person closes it (Esc, ✕, ctrl+x x), whether it can tell them apart and remember "closed for this session"; how a `/chat-toc` command reopens it; who owns mouse clicks, focus, ↑↓/Enter and scrolling inside the Pane; width requests like `preferredColumns`; showing and clearing the status line `$.ui.status`; behaviour as a tab beside another mod's Pane; whether the Pane survives a reload. Note for each the version it is available from and what a prototype must measure.

## Answer

The research document is `docs/research/chat-toc/02-pane-lifecycle.md` on branch `research/chat-toc-pane-lifecycle` (commit e1a8899, not merged). The main reference is the official built-in mod `cc-plugin-diff` (anthropics/claude-code@e47cc82 `mods/diff/`): it opens by itself, remembers a close, opens by itself only when docked and scrolls on its own, almost the same shape as chat-toc.

- **Placement**: whether it seats depends on "did the person ask": opened by a command, prompt or control, it seats at any width; unasked, as at `session.start`, it needs ≥144 columns, lowered to 110 once the person asked for it and has not closed it by hand, and back to 144 after one manual close. Where it seats depends on the layout: fullscreen and ≥110 columns docks, otherwise inline. Too narrow returns `{isPlaced:false, reason}`: the Pane is open but undrawn, and seats by itself when wider or when the person opens it. **There is no "dock only" switch**: as diff does, read `viewport.isFullscreen` in render (fixed for the session), open by itself only when true, and close at once to withdraw on `isPlaced:false`.
- **Closing**: ✕, `ctrl+x x` and (with `closeOnEscape` on) Esc all raise `ui.close` with `origin.kind === 'person'`, with no telling which; record it after `next` in the hook. Recommended: **no `closeOnEscape`**, or an idle Esc closes the contents by mistake.
- **`/chat-toc` reopening**: an open inside a command counts as asked and seats at any width; opening an id already open only changes the title; `focus:true` works only with an empty prompt; registering with `immediate:true` lets it run while Claude works.
- **Keys and scrolling**: a mod cannot bind Tab or the arrow keys; ↑↓ move along the focus ring when it fits and scroll when it overflows; Enter presses the focused Button; a click in fullscreen raises `ui.press`. Hooking `ui.scroll` to return `{}` keeps the offset itself and draws only the visible part (diff and prompt-history both do). The engine's `$.ui.scroll({to:'end'})` redrew without end until 2.1.290, so following the newest is the mod's own `isFollowing`, holding the `>=2.1.287` floor. A tree draws only its first 100,000 characters, so rendering on demand is a must.
- **Width**: the request field is `columns` (there is no `preferredColumns`); a width the person set wins.
- **Status line**: `$.ui.status(text)` is one line per plugin with a `⚠ module name:` prefix, cleared by `undefined`; use it only for a real gap (terminal too narrow, not fullscreen).
- **Sharing with diff**: only one Pane shows at a time, the rest are tabs; diff opens by itself at the first file edit, so side by side is the norm; `$.ui.panes()`' `isShown` tells whether it is in front.
- **Reload**: a hot reload does not close the Pane, but `session.start` fires again, so check `$.ui.panes()` and the "closed for this session" mark first. The mark goes in `$.state`: kept by a reload, but reset by `/clear`, `/resume` and `/branch` (so it opens by itself again after those); cross-session preferences (the View filter) go in `$.store`.
- **Versions**: the Pane APIs carry no "Requires" note and 2.1.287's own diff already uses them, so they are inferred to be in 2.1.287, to check on the real host; clearly later are `$.ui.selection` 2.1.288, `ui.fault` 2.1.289 and the follow-the-end redraw fix 2.1.290.
- **Left for the prototype to measure**: whether a docked Pane that narrows turns inline or unseats; whether opening the Pane in render is reliable; the scope of the 110 memory; whether `ui.scroll` fires when the tree fits the window; whether opening an id in the back brings it forward; where the dock width is kept; with diff, who is in front and whether a back tab keeps rendering; whether the status and the Pane survive reload, `/clear` and `/resume`.
