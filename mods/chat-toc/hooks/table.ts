/* The entry table: what the pane lists, kept between drawings so a long
   session's redraw does not fold every entry again.

   Each group's entries are kept under its opener while the group shows the
   same (its place, whether it runs, its steps, how it ended, its reply, its
   User input), so a read that grows only the last group folds only that
   one. The list, with each entry's height, the keys and their way back, and
   where each group's entries start, changes only when the groups, the
   width, the View filter, the Layout or the running turn do; when only the
   newest groups changed (a read of what the file grew by), only the list's
   end is taken off and laid again. The highlight and the selection are laid
   on when drawing.

   The table's arrays are the cache's own and change with the next call: a
   table is good until then. */

import { entryRows, groupEntries, withoutTrailingGap } from './entries'
import type { Entry, EntryOptions } from './entries'
import type { TurnGroup } from './groups'

export type EntryTable = {
  entries: Entry[]
  /* The rows each entry takes, the gap after it included. */
  heights: number[]
  keys: string[]
  indexOf: Map<string, number>
  /* Where each group's entries start; a group that shows none starts where
     the next one does. */
  firstOfGroup: number[]
}

type Kept = {
  group: TurnGroup
  index: number
  isRunning: boolean
  entries: Entry[]
}

export type EntryCache = {
  /* The width, filter, Layout and year the kept entries were folded for. */
  shape: string
  byOpener: Map<string, Kept>
  groups: readonly TurnGroup[] | undefined
  isRunning: boolean
  table: EntryTable | undefined
}

export function newEntryCache(): EntryCache {
  return { shape: '', byOpener: new Map(), groups: undefined, isRunning: false, table: undefined }
}

/* The entry of group `group` to show: its first or, when it shows none, the
   first of a later group that does; else the last entry. Undefined when
   nothing is listed. */
export function entryOfGroup(table: EntryTable, group: number): number | undefined {
  if (table.entries.length === 0) return undefined
  const at = table.firstOfGroup[group]
  return at === undefined ? undefined : Math.min(at, table.entries.length - 1)
}

/* The day matters: the day's rule says which day is today, and a time
   from another year shows the year. */
const shapeOf = (o: EntryOptions) => `${o.layout}|${o.filter}|${o.width}|${new Date(o.nowMs).toDateString()}`

/* Whether two groups draw the same. */
function drawsSame(a: TurnGroup, b: TurnGroup): boolean {
  return (
    a === b ||
    (a.openerUuid === b.openerUuid &&
      a.kind === b.kind &&
      a.userText === b.userText &&
      a.timestamp === b.timestamp &&
      a.hasAgentReply === b.hasAgentReply &&
      a.steps === b.steps &&
      a.ending === b.ending &&
      a.reply?.text === b.reply?.text &&
      a.reply?.uuid === b.reply?.uuid &&
      a.lastAgentUuid === b.lastAgentUuid)
  )
}

function entriesFor(cache: EntryCache, group: TurnGroup, index: number, isRunning: boolean, options: EntryOptions): Entry[] {
  const kept = cache.byOpener.get(group.openerUuid)
  if (kept !== undefined && kept.index === index && kept.isRunning === isRunning && drawsSame(kept.group, group)) {
    kept.group = group
    return kept.entries
  }
  const entries = groupEntries(group, index, isRunning, options)
  cache.byOpener.set(group.openerUuid, { group, index, isRunning, entries })
  return entries
}

/* How many groups from the first the new list shares with the one laid:
   the same group objects, short of the old last group, of the group of the
   old last entry (it lost its gap, which an entry after it brings back) and
   of a running group. */
function keptGroups(cache: EntryCache, groups: readonly TurnGroup[], isRunning: boolean): number {
  const old = cache.groups
  const table = cache.table
  if (old === undefined || table === undefined) return 0
  let keep = 0
  const limit = Math.min(old.length - 1, groups.length, table.entries.at(-1)?.groupIndex ?? old.length)
  while (keep < limit && old[keep] === groups[keep]) keep++
  if (isRunning) keep = Math.min(keep, groups.length - 1)
  return Math.max(0, keep)
}

function emptyTable(): EntryTable {
  return { entries: [], heights: [], keys: [], indexOf: new Map(), firstOfGroup: [] }
}

export function entryTable(cache: EntryCache, groups: readonly TurnGroup[], options: EntryOptions): EntryTable {
  const shape = shapeOf(options)
  if (cache.table !== undefined && cache.shape === shape && cache.groups === groups && cache.isRunning === options.isRunning) return cache.table
  if (cache.shape !== shape) {
    cache.shape = shape
    cache.byOpener = new Map()
    cache.table = undefined
  }
  const keep = keptGroups(cache, groups, options.isRunning)
  const was = cache.table ?? emptyTable()
  const cut = keep === 0 ? 0 : (was.firstOfGroup[keep] ?? was.entries.length)
  for (let i = cut; i < was.keys.length; i++) was.indexOf.delete(was.keys[i]!)
  const { entries, heights, keys, indexOf, firstOfGroup } = was
  entries.length = cut
  heights.length = cut
  keys.length = cut
  firstOfGroup.length = keep
  const last = groups.length - 1
  for (let i = keep; i < groups.length; i++) {
    firstOfGroup.push(entries.length)
    for (const entry of entriesFor(cache, groups[i]!, i, options.isRunning && i === last, options)) {
      indexOf.set(entry.key, entries.length)
      entries.push(entry)
      keys.push(entry.key)
      heights.push(entryRows(entries, entries.length - 1))
    }
  }
  withoutTrailingGap(entries)
  const end = entries.length - 1
  if (end >= 0) heights[end] = entryRows(entries, end)
  /* Groups gone from the list (a rewind's, a /clear's) are let go. */
  if (cache.byOpener.size > groups.length) {
    const openers = new Set(groups.map(g => g.openerUuid))
    for (const opener of cache.byOpener.keys()) if (!openers.has(opener)) cache.byOpener.delete(opener)
  }
  cache.groups = groups
  cache.isRunning = options.isRunning
  cache.table = { entries, heights, keys, indexOf, firstOfGroup }
  return cache.table
}

/* The table narrowed to the groups `shown` (a query's matches, in order):
   their entries only, each keeping its group's index into the whole list,
   so a jump, the highlight and the compactions' places read as before.
   The heights are counted again, a day's rule now coming from the entry
   shown before, and the last entry shown loses its gap. A group not shown
   starts where the next shown one does. */
export function narrowedTable(table: EntryTable, shown: readonly number[]): EntryTable {
  const groups = table.firstOfGroup.length
  /* Every group shown (`shown` is in order, without repeats): the table
     itself, as the first keystroke of a search often gives it. */
  if (shown.length === groups) return table
  const entries: Entry[] = []
  for (const g of shown) {
    const from = table.firstOfGroup[g]
    if (from === undefined) continue
    const to = table.firstOfGroup[g + 1] ?? table.entries.length
    for (let i = from; i < to; i++) entries.push(table.entries[i]!)
  }
  withoutTrailingGap(entries)
  const heights = entries.map((_, i) => entryRows(entries, i))
  const keys = entries.map(e => e.key)
  const indexOf = new Map(keys.map((key, i) => [key, i]))
  const firstOfGroup: number[] = []
  let at = 0
  for (let g = 0; g < groups; g++) {
    while (at < entries.length && entries[at]!.groupIndex < g) at++
    firstOfGroup.push(at)
  }
  return { entries, heights, keys, indexOf, firstOfGroup }
}
