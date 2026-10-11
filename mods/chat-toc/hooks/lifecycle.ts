/* When the pane opens and stays closed (spec §2), as plain decisions;
   register.tsx makes the calls on `$`. */

import type { PaneCloseInput } from 'claude-code'
import { PANE_ID } from './pane'

/* The one close that keeps the pane closed for the rest of the session:
   the person closing chat-toc's own pane. A plugin's close, an unload and
   every other pane's close leave the mark alone. */
export function isClosedByPerson(e: PaneCloseInput): boolean {
  return e.id === PANE_ID && e.origin.kind === 'person'
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

/* The status line while the pane cannot dock (spec §2): why, and what gets
   the dock. Where the width lies is the host's to say, so none names a
   column count. */
export const DOCK_STATUS = {
  /* The main screen places a pane inline only; nothing opens by itself. */
  mainScreen: '目录只在全屏布局里停靠在右侧，运行 /tui fullscreen 切换',
  /* An unasked pane waits undrawn until the host has the room. */
  narrow: '终端太窄，目录没有停靠；把终端拉宽后会自动出现',
  /* /chat-toc asked: the host placed it inline, and docks it when wider. */
  askedNarrow: '终端太窄，目录暂时放在输入框上方；把终端拉宽后会停靠到右侧',
  askedMainScreen: '非全屏布局里目录放在输入框上方；运行 /tui fullscreen 切换后会停靠到右侧',
} as const

export type Placement = 'dock' | 'inline'

/* What a drawing of the pane at `placement` asks of chat-toc: docked, the
   status line clears; inline, it is kept only when /chat-toc asked for it
   while it could not dock, and otherwise withdrawn to wait for the room. */
export function placementFate(placement: Placement, isInlineAsked: boolean): 'docked' | 'asked-inline' | 'withdraw' {
  if (placement === 'dock') return 'docked'
  return isInlineAsked ? 'asked-inline' : 'withdraw'
}
