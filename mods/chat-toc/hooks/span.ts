/* The part of the list the desktop draws (spec §8, Scrolling). There the
   host scrolls the Pane's whole tree, and a tree is bounded at 100,000
   serialized characters, Svg sources included, so the list is not windowed
   by rows: it draws a run of entries whose characters fit a budget, the
   newest unless the person moved it to earlier turns. A run starts and ends
   on a Turn group's edge, so its earlier and later parts count whole
   groups. */

import type { TocWindow } from './window'

/* What a run draws of an entry list: `cost(i)` the characters entry i
   draws, `groupOf(i)` its Turn group. */
export type SpanList = {
  length: number
  cost: (i: number) => number
  groupOf: (i: number) => number
}

/* The run whose last entry is `end - 1`, as many entries back as fit
   `budget`, starting on a group's first entry; at least that last entry's
   group, whatever it costs. */
export function spanEnding(list: SpanList, end: number, budget: number): TocWindow {
  const last = Math.max(0, Math.min(end, list.length))
  let start = last
  let used = 0
  while (start > 0) {
    const next = used + list.cost(start - 1)
    if (next > budget && start < last) break
    used = next
    start -= 1
  }
  /* A group cut at the top is left out, unless it is the only one. */
  const cut = start
  while (start > 0 && start < last && list.groupOf(start) === list.groupOf(start - 1)) start += 1
  if (start === last) {
    start = cut
    while (start > 0 && list.groupOf(start) === list.groupOf(start - 1)) start -= 1
  }
  return { start, end: last, maxStart: start }
}

/* The run ending at `end - 1` as spanEnding draws it, unless that reaches
   the list's first entry with budget to spare: then the run from the first
   entry filling the budget, so the earliest part is drawn as full as any
   other (spec §8). */
export function spanEndingFilled(list: SpanList, end: number, budget: number): TocWindow {
  const run = spanEnding(list, end, budget)
  return run.start === 0 ? spanStarting(list, 0, budget) : run
}

/* The run whose first entry is `start`, as many entries on as fit
   `budget`, ending on a group's last entry; at least `start`'s group. */
export function spanStarting(list: SpanList, start: number, budget: number): TocWindow {
  const first = Math.max(0, Math.min(start, list.length))
  let end = first
  let used = 0
  while (end < list.length) {
    const next = used + list.cost(end)
    if (next > budget && end > first) break
    used = next
    end += 1
  }
  const cut = end
  while (end < list.length && end > first && list.groupOf(end) === list.groupOf(end - 1)) end -= 1
  if (end === first) {
    end = cut
    while (end < list.length && list.groupOf(end) === list.groupOf(end - 1)) end += 1
  }
  return { start: first, end, maxStart: first }
}

/* The Turn groups among entries `from` to `to` (one past). */
export function groupsIn(list: SpanList, from: number, to: number): number {
  let n = 0
  for (let i = from; i < to; i++) if (i === from || list.groupOf(i) !== list.groupOf(i - 1)) n += 1
  return n
}

/* One past the last entry of the list's groups up to `group`; the list's
   end for undefined (the newest). */
export function endOfGroup(list: SpanList, group: number | undefined): number {
  if (group === undefined) return list.length
  let end = list.length
  while (end > 0 && list.groupOf(end - 1) > group) end -= 1
  return end
}
