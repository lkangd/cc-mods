/* The conversation chain: the rows of the branch the conversation is on now,
   found by walking back from the newest leaf along `parentUuid`, and across
   a compaction's boundary row (which has none) along `logicalParentUuid`, so
   the turns from before a compaction stay on it. A rewound-away branch is
   not on it; a subagent's sidechain is not either.

   The rows are kept in an index that grows as the file is read, so a read
   of new lines walks back only until it meets the chain it already had. */

import type { TranscriptRow } from './transcript'

const CHAIN_TYPES = new Set(['user', 'assistant', 'system'])

export type ChainIndex = {
  /* Every row that may be on the chain, by uuid; a uuid written again keeps
     its latest row. */
  byId: Map<string, TranscriptRow>
  /* The newest row the chain can end at. */
  leaf: string | undefined
}

export function chainIndex(): ChainIndex {
  return { byId: new Map(), leaf: undefined }
}

/* Adds rows read from the file, in file order. True when one of them came
   under a uuid already indexed: a row written again, which may change rows
   already on the chain. */
export function indexRows(index: ChainIndex, rows: readonly TranscriptRow[]): boolean {
  let isRewrite = false
  for (const row of rows) {
    if (row.isSidechain) continue
    if (index.byId.has(row.uuid)) isRewrite = true
    index.byId.set(row.uuid, row)
    if (row.type !== undefined && CHAIN_TYPES.has(row.type)) index.leaf = row.uuid
  }
  return isRewrite
}

/* The row a chain row follows. A compaction's boundary row starts a fresh
   `parentUuid` chain and names the row it came after in
   `logicalParentUuid`. */
function parentOf(row: TranscriptRow): string | undefined {
  if (row.parentUuid) return row.parentUuid
  if (row.type === 'system' && row.subtype === 'compact_boundary') return row.logicalParentUuid ?? undefined
  return undefined
}

export type Walk = {
  /* The rows walked, oldest first; `stopAt` itself is not among them. */
  rows: TranscriptRow[]
  /* Whether the walk met `stopAt`. When it did not, `rows` is the whole
     chain. */
  isMet: boolean
}

/* Walks back from the leaf until `stopAt`, or to the chain's start. */
export function walkBack(index: ChainIndex, stopAt?: string): Walk {
  const back: TranscriptRow[] = []
  const seen = new Set<string>()
  let at = index.leaf
  while (at !== undefined && !seen.has(at)) {
    if (at === stopAt) return { rows: back.reverse(), isMet: true }
    const row = index.byId.get(at)
    if (!row) break
    seen.add(at)
    back.push(row)
    at = parentOf(row)
  }
  return { rows: back.reverse(), isMet: false }
}

export function currentChain(rows: readonly TranscriptRow[]): TranscriptRow[] {
  const index = chainIndex()
  indexRows(index, rows)
  return walkBack(index).rows
}
