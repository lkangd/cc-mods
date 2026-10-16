/* Compactions: each `system/compact_boundary` row on the chain, with its
   trigger and time, and where its rule goes among the Turn groups. A Turn
   group is never cut by one: the rule goes before or after the group the
   boundary falls in.
     manual             after the `/compact` entry, though the chain has
                        the boundary just before the command row;
     auto at a submit   (the boundary in the new group before any agent
                        row) before that group;
     auto mid-turn      after the group (a running group's at the list's
                        end until the next group comes);
     auto between turns between the two groups. */

import { entryRows } from './entries'
import type { Entry } from './entries'
import type { TurnGroup } from './groups'
import type { TranscriptRow } from './transcript'

export type Compaction = {
  /* The boundary row's uuid. */
  uuid: string
  trigger: 'manual' | 'auto'
  /* The boundary row's timestamp (UTC ISO), when it has one. */
  timestamp: string | undefined
  /* The group the rule goes before; the group count when it goes after
     the last. */
  at: number
  /* Whether a response follows it on the chain: until one does, the host
     has no context use to give. */
  isAnswered: boolean
}

const isBoundary = (row: TranscriptRow) => row.type === 'system' && row.subtype === 'compact_boundary'

const triggerOf = (row: TranscriptRow): 'manual' | 'auto' =>
  (row as { compactMetadata?: { trigger?: unknown } }).compactMetadata?.trigger === 'auto' ? 'auto' : 'manual'

const isCompactCommand = (group: TurnGroup | undefined) => group?.kind === 'command' && /^\/compact(\s|$)/.test(group.userText)

/* The chain's compactions, oldest first, each placed against `groups`
   (the chain's Turn groups, as `groupTurns` gives them). */
export function compactionsOf(chain: readonly TranscriptRow[], groups: readonly TurnGroup[]): Compaction[] {
  const found: Compaction[] = []
  /* The group the rows walked belong to; -1 before the first. */
  let g = -1
  let hasAgentRow = false
  for (const row of chain) {
    if (row.uuid === groups[g + 1]?.openerUuid) {
      g += 1
      hasAgentRow = false
    }
    if (row.type === 'assistant') {
      hasAgentRow = true
      for (let i = found.length - 1; i >= 0 && !found[i]!.isAnswered; i--) found[i]!.isAnswered = true
    }
    if (!isBoundary(row)) continue
    const trigger = triggerOf(row)
    let at: number
    if (trigger === 'manual') at = isCompactCommand(groups[g]) || !isCompactCommand(groups[g + 1]) ? g + 1 : g + 2
    else at = hasAgentRow ? g + 1 : Math.max(0, g)
    found.push({ uuid: row.uuid, trigger, timestamp: row.timestamp, at, isAnswered: false })
  }
  return found
}

/* One rule row: the compactions that fell in one place among the groups
   shown, folded, with the last one's trigger and time. */
export type CompactionRule = { trigger: 'manual' | 'auto'; count: number; timestamp: string | undefined }

export type PlacedRules = {
  /* The rule drawn before a shown group, by its group index. */
  before: Map<number, CompactionRule>
  /* The rule drawn after the last shown group. */
  after: CompactionRule | undefined
}

/* The rules among the groups shown, `shown` their group indices in order,
   whatever left them (the View filter, a query): each compaction's rule
   goes before the first shown group at or after its place, else after the
   last shown group. With none shown there are none. Pure over its inputs,
   so the list under a query places them the same way. */
export function rulesAmong(compactions: readonly Compaction[], shown: readonly number[]): PlacedRules {
  const placed: PlacedRules = { before: new Map(), after: undefined }
  if (shown.length === 0) return placed
  const fold = (was: CompactionRule | undefined, c: Compaction): CompactionRule => ({
    trigger: c.trigger,
    count: (was?.count ?? 0) + 1,
    timestamp: c.timestamp,
  })
  let s = 0
  for (const c of compactions) {
    while (s < shown.length && shown[s]! < c.at) s++
    const group = shown[s]
    if (group === undefined) placed.after = fold(placed.after, c)
    else placed.before.set(group, fold(placed.before.get(group), c))
  }
  return placed
}

/* What the list draws: its entries, each one's rows, and where each
   group's entries start (a group that shows none starts where the next
   one does), as the entry table keeps them. */
export type Listed = { entries: readonly Entry[]; heights: readonly number[]; firstOfGroup: readonly number[] }

/* The groups that show entries, by index, in order. */
export function shownOf(listed: Listed): number[] {
  const shown: number[] = []
  const { firstOfGroup, entries } = listed
  for (let g = 0; g < firstOfGroup.length; g++) {
    if (firstOfGroup[g]! < (firstOfGroup[g + 1] ?? entries.length)) shown.push(g)
  }
  return shown
}

/* The list with the compactions' rules laid on: a rule before a shown
   group goes on its first entry, one after the last on the last entry,
   and each such entry's rows count it. The list given is not changed;
   with no rule it is given back. Compactions placed past the groups listed
   (a rewind's) are left out. */
export function layRules(listed: Listed, compactions: readonly Compaction[]): Listed {
  const groups = listed.firstOfGroup.length
  const placed = compactions.length === 0 ? undefined : rulesAmong(compactions.filter(c => c.at <= groups), shownOf(listed))
  if (placed === undefined || (placed.before.size === 0 && placed.after === undefined)) return listed
  const entries = listed.entries.slice()
  const heights = listed.heights.slice()
  const lay = (i: number, rule: Partial<Entry>) => {
    const entry = entries[i]
    if (entry === undefined) return
    entries[i] = { ...entry, ...rule }
    heights[i] = entryRows(entries, i)
  }
  for (const [group, rule] of placed.before) lay(listed.firstOfGroup[group]!, { compactionBefore: rule })
  if (placed.after !== undefined) lay(entries.length - 1, { compactionAfter: placed.after })
  return { entries, heights, firstOfGroup: listed.firstOfGroup }
}

/* Whether earlier turns of the conversation are not in this file: the
   chain's first boundary comes before its first group. That covers a
   fork's file, which starts at a boundary whose `logicalParentUuid` the
   file does not hold, and a resumed file compacted before any turn of its
   own. The parent transcript is not read. */
export function hasEarlierTurnsElsewhere(chain: readonly TranscriptRow[], groups: readonly TurnGroup[]): boolean {
  const opener = groups[0]?.openerUuid
  for (const row of chain) {
    if (row.uuid === opener) return false
    if (isBoundary(row)) return true
  }
  return false
}
