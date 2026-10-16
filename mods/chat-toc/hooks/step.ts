/* The previous and next Turn group (spec §6): two plain Buttons, `‹` and
   `›`, at the search row's right end and in the band, that step the
   transcript from the Current position to the group before or after it
   among the groups the list shows. Each carries a borrowed keybinding
   action, so a key the person binds to it presses the Button from the
   composer; chat-toc binds none. The names mean something else in Claude
   Code (diff dialog switches with no handler mounted in a normal session):
   a later Claude Code that mounts one takes the key back. The scroll itself
   is `step` in register.tsx, which may hold the host's `$`. */

import type { ViewFilter } from './view'

export const PREVIOUS_ACTION = 'app:toggleDiffNoiseFilter'
export const NEXT_ACTION = 'app:toggleDiffPreSession'

/* The Buttons' keys, in the pane and in the band. */
export const PREVIOUS_CONTROL = 'step.previous'
export const NEXT_CONTROL = 'step.next'
export const BAND_PREVIOUS = 'chat-toc-band.previous'
export const BAND_NEXT = 'chat-toc-band.next'

export const isStepKey = (key: string | undefined) => key === PREVIOUS_CONTROL || key === NEXT_CONTROL

export type StepDirection = 'previous' | 'next'

export type Step =
  /* Jump to this group. */
  | { kind: 'jump'; group: number }
  /* No shown group that way: nothing happens. */
  | { kind: 'end' }
  /* Shown groups that way, none with a Jump target. */
  | { kind: 'unjumpable' }

/* The groups the list shows, ascending: every group under All and User,
   under Agent those with an Agent side (a reply, or the running group's);
   during a search only the matches (`matches`, ascending) among them. */
export function listedGroups(
  groups: readonly { hasAgentReply: boolean }[],
  filter: ViewFilter,
  runningGroup: number | undefined,
  matches: readonly number[] | undefined,
): number[] {
  const isListed = (g: number) => filter !== 'agent' || groups[g]?.hasAgentReply === true || g === runningGroup
  const among = matches ?? groups.map((_, g) => g)
  return among.filter(g => g >= 0 && g < groups.length && isListed(g))
}

/* The group a step goes to from the Current position `position` (a group
   index; undefined with none, which previous takes as past the newest)
   over `shown`, skipping groups without a Jump target. */
export function stepFrom(shown: readonly number[], position: number | undefined, direction: StepDirection, hasTarget: (group: number) => boolean): Step {
  const way =
    direction === 'previous'
      ? shown.filter(g => position === undefined || g < position).reverse()
      : position === undefined
        ? []
        : shown.filter(g => g > position)
  if (way.length === 0) return { kind: 'end' }
  const group = way.find(hasTarget)
  return group === undefined ? { kind: 'unjumpable' } : { kind: 'jump', group }
}
