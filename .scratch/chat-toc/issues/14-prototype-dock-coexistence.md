# Decide how to share the dock with other Panes

Type: prototype
Status: resolved
Blocked by: 

## Question

When other mods such as `cc-plugin-diff` also open a docked Pane, the host turns them into tabs. After measuring the two enabled together on this machine, decide:
- when chat-toc opens by itself at session start, does it take the foreground tab;
- after the other Pane closes, how does chat-toc return to the foreground;
- after the person closes chat-toc, does the "closed for this session" state affect the other Pane, and does the other's affect chat-toc;
- do the Current position following and the highlight update as usual in a background tab.

The conclusion is for `CT-COEX-001` to cite.

## Answer

**Verdict (confirmed by the user)**: chat-toc follows the host's tab rules entirely, and neither tracks nor takes over other plugins' Panes.
- **Opening by itself**: at session start, or when reopening after `/clear` or `/resume`, if another Pane is already open, chat-toc goes to the foreground by the host's rule and the other becomes a tab. No extra check.
- **Switching between foreground and background**: when another Pane opens midway and pushes chat-toc to the background, or closes and chat-toc returns to the foreground, chat-toc does nothing: it does not use `focus` to take the foreground back (that would take the keyboard), and it gives no notice.
- **Closed state**: each keeps its own. Only a `ui.close` with `e.id === 'toc'` and `origin.kind === 'person'` records "closed for this session". However the other Pane is closed, this mark is not touched, and closing chat-toc does not affect the other.
- **Background updates**: nothing is drawn in the background, but the data layer works as usual (the transcript hook still works out the Current position and writes `$.state`). If the Current position changes while chat-toc is not in the foreground (`isShown === false` in `$.ui.panes()`), the following pause caused by a manual scroll is cancelled. So the first frame after it returns to the foreground scrolls to the group now highlighted.

**Host facts (2.1.287 and 2.1.295 agreed, 170×44 fullscreen)**
1. A newly opened Pane is always in the foreground, whether or not the person requested it and with or without `focus`: another plugin opening by a timer, `/diff`, and chat-toc reopened after `/clear` all behave this way.
2. Opening again an id that is open but in the background with `$.ui.open`: without `focus` it is not brought forward (it only returns `{isPlaced:true}`); with `focus` and an empty prompt it is brought forward and takes the keyboard.
3. After the foreground Pane is closed (the plugin's `close`, or the person's click on ✕), the remaining one returns to the foreground by itself and draws its first frame with the latest `$.state`. Clicking a tab to switch is the same, but a click on a tab does not give focus.
4. A background tab does not call the Pane's render hook at all (the "render while hidden" entries in the log are all the first frame after it became shown, earlier than the record of the 500 ms `panes()` poll).
5. The dock width follows the `columns` the foreground tab asked for (TOC 44 / Other 50 / Diff about 80). chat-toc's width takes effect only while it is in the foreground.
6. The `ui.open` / `ui.close` hooks see other plugins' open and close events (the built-in `diff` included), with their `id` and `origin`; `$.ui.panes()` lists only its own.
7. With only one Pane no tab row is drawn. 2.1.295 draws ✕ on row 0; 2.1.287 draws ✕ at the right of the first line of content.
8. **A new finding, affecting `CT-LIFE-002` in "Finalise the compatibility and acceptance contract"**: `session.start` does **not** fire on `/clear` (the d.ts says "never `/clear`"), and the measurement agrees. If it opens by itself only in `session.start`, it does not pop up again after `/clear` (`$.state` really is reset). The implementation has to hook `classic.SessionStart` and, when `source` is `clear` or `resume`, open under the same conditions (not closed in this session, not in `panes()`). The probe verified it works on both versions, and the reopened TOC goes in front of Diff. Also, `/clear` resets other `$.state` atoms to their defaults (the tick goes back to 0).

**Not measured**: the real automatic opening of Diff when Claude first edits a file needs a model call and was not measured; Other opened by a timer (also an unrequested open) stood in for it, and the result matched `/diff`.

**Assets**: `assets/14-coexist/`. `toc-coex/` is a stand-in for chat-toc, opening by itself in `session.start` and `classic.SessionStart`, writing `$.state` every 500 ms and logging `isShown`; `other-coex/` is another dock Pane that opens by itself. `drv.py` is a private PTY driver, `run.sh` / `cmd.sh` / `scr.sh` / `seq.sh` are driver scripts, of which `seq.sh` is the full sequence for 2.1.287. `logs/seq-287.txt` is a screen capture of the foreground tab at each step, and `logs/toc-*.json` are the event logs.
