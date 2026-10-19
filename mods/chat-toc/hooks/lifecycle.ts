/* When the pane opens and stays closed (MVP spec §2), as plain decisions;
   register.tsx makes the calls on `$`. */

import type { PaneCloseInput } from 'claude-code'
import { PANE_ID } from './pane'

/* The one close that keeps the pane closed for the rest of the session:
   the person closing chat-toc's own pane. A plugin's close, an unload and
   every other pane's close leave the mark alone. */
export function isClosedByPerson(e: PaneCloseInput): boolean {
  return e.id === PANE_ID && e.origin.kind === 'person'
}

/* A close that takes chat-toc's pane off screen while the plugin stays:
   the person's, or any but an unload. The band above the prompt then
   offers it again. */
export function hidesPane(e: PaneCloseInput): boolean {
  return e.id === PANE_ID && e.origin.kind !== 'unload'
}

/* `classic.SessionStart` sources that begin another conversation in this
   process, which `session.start` does not hear of: the pane opens again for
   it. A compaction continues the same one. */
export function reopensOn(source: string): boolean {
  return source === 'clear' || source === 'resume'
}

/* Sources of a session that takes over another's history: it shows in the
   transcript while the session's own file may not exist yet (a fork's is
   written at its first submit). */
export function carriesHistory(source: string): boolean {
  return source === 'resume' || source === 'fork'
}
