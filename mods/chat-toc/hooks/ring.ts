/* The selection cursor: the host's focus ring over the pane's Buttons, kept
   on entries' first lines. While the pane's tree fits (chat-toc draws only
   its window) the host moves the ring Button by Button with the arrows, and
   wraps from the last Button to the first and back. Every line of an entry
   is a Button, so a step would land on a body line; this turns each step
   into a step from entry to entry, and past either end of the window into a
   scroll of it, so the arrows reach every entry. */

import { isBarKey } from './bars'
import type { TocWindow } from './window'

/* The controls around the entries, in the ring's order: the filter row's
   Buttons left to right, the entries, then the preview's Buttons and the
   footer's Layout Button. */
export const FIRST_CONTROL = 'f-all'
export const FILTER_END = 'f-agent'
export const LAYOUT_CONTROL = 'layout'
/* The controls after the entries. */
const AFTER_LIST = new Set([LAYOUT_CONTROL, 'preview', 'preview.more'])
const isAfterList = (key: string | undefined) => key !== undefined && AFTER_LIST.has(key)

export type RingMove =
  /* Let the ring land where the host moves it. */
  | { kind: 'accept' }
  /* Land on this drawn key instead. */
  | { kind: 'land'; key: string }
  /* Bring entry `index` into the window, then land on its first line. */
  | { kind: 'reveal'; index: number }

type At = { index: number; line: number }

/* Where a Button key is among the entries: `g3.u` is entry g3.u's first
   line, `g3.u.2` its third. Undefined for a key that is no entry's. */
export function entryAt(key: string | undefined, indexOf: ReadonlyMap<string, number>): At | undefined {
  if (key === undefined) return undefined
  const whole = indexOf.get(key)
  if (whole !== undefined) return { index: whole, line: 0 }
  const cut = key.lastIndexOf('.')
  const index = cut > 0 ? indexOf.get(key.slice(0, cut)) : undefined
  const line = Number(key.slice(cut + 1))
  return index === undefined || !Number.isInteger(line) ? undefined : { index, line }
}

/* A ring move chat-toc owes, to an entry a drawing is to bring in: the key
   once this drawing's window shows that entry, else undefined (it waits for
   a later drawing, or its entry is gone). */
export function pendingShown(pending: string | undefined, indexOf: ReadonlyMap<string, number>, window: TocWindow): string | undefined {
  const index = pending === undefined ? undefined : indexOf.get(pending)
  return index !== undefined && index >= window.start && index < window.end ? pending : undefined
}

/* The host moving the ring from `from` (where it was; undefined when the
   pane just took the keyboard) to `to` (undefined for one of the host's own
   stops, or a Minimap cell). `keys[i]` is entry i's key, `indexOf` the table back.
   `after` is the first control drawn after the entries. */
export function ringMove(
  keys: readonly string[],
  indexOf: ReadonlyMap<string, number>,
  window: TocWindow,
  from: string | undefined,
  to: string | undefined,
  after: string = LAYOUT_CONTROL,
): RingMove {
  const was = entryAt(from, indexOf)
  const next = entryAt(to, indexOf)
  /* The Minimap's cells are for the pointer: the ring steps over them,
     from the filter row down to the first entry in the window, from an
     entry up to the filter row. */
  if (isBarKey(to)) {
    if (was === undefined) {
      /* Up from the Layout Button, with no entry to land on, goes on to the filter row. */
      if (isAfterList(from)) return { kind: 'land', key: FILTER_END }
      return { kind: 'land', key: keys[window.start] !== undefined && window.start < window.end ? keys[window.start]! : after }
    }
    if (was.index === window.start && window.start > 0) return { kind: 'reveal', index: window.start - 1 }
    return { kind: 'land', key: FILTER_END }
  }
  if (next === undefined) {
    /* Down from the window's last entry goes on to the footer: show the
       entry after it instead, while there is one. */
    if (isAfterList(to) && was?.index === window.end - 1 && window.end < keys.length) return { kind: 'reveal', index: window.end }
    /* Up from the window's first entry goes on to the filter row: show the
       entry before it instead, while there is one. */
    if (to === FILTER_END && was?.index === window.start && window.start > 0) return { kind: 'reveal', index: window.start - 1 }
    return { kind: 'accept' }
  }
  if (next.line === 0) return { kind: 'accept' }
  /* Down off an entry's first line onto its second: the next entry. */
  if (was?.index === next.index) {
    const below = next.index + 1
    if (below < window.end) return { kind: 'land', key: keys[below] ?? after }
    if (below < keys.length) return { kind: 'reveal', index: below }
    return { kind: 'land', key: after }
  }
  /* Up onto an entry's last line, or anything else onto a later line: that
     entry's first line. */
  return { kind: 'land', key: keys[next.index] ?? FIRST_CONTROL }
}
