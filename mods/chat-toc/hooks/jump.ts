/* Jump targets: which transcript row a press on an entry scrolls to. A
   user-role row's `ui.render` `requestId` is its transcript uuid, so a
   prompt's own uuid is its target; `$.ui.scroll` reaches rows the host lists
   even when they were never drawn. The scroll itself is `jump` in
   register.tsx, which may hold the host's `$`. */

import type { UiScrollBlock } from 'claude-code'
import type { Entry } from './entries'

export type JumpTarget = { requestId: string; block: UiScrollBlock }

export function jumpTargetOf(entry: Entry): JumpTarget {
  return { requestId: entry.jumpUuid, block: 'start' }
}
