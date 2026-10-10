/* The conversation chain: the rows of the branch the conversation is on now,
   found by walking back from the newest leaf along `parentUuid`. A rewound-
   away branch is not on it; a subagent's sidechain is not either. */

import type { TranscriptRow } from './transcript'

const CHAIN_TYPES = new Set(['user', 'assistant', 'system'])

export function currentChain(rows: readonly TranscriptRow[]): TranscriptRow[] {
  const byId = new Map<string, TranscriptRow>()
  let leaf: string | undefined
  for (const row of rows) {
    if (row.isSidechain) continue
    byId.set(row.uuid, row)
    if (row.type !== undefined && CHAIN_TYPES.has(row.type)) leaf = row.uuid
  }
  const back: TranscriptRow[] = []
  const seen = new Set<string>()
  let at = leaf
  while (at !== undefined && !seen.has(at)) {
    const row = byId.get(at)
    if (!row) break
    seen.add(at)
    back.push(row)
    at = row.parentUuid ?? undefined
  }
  return back.reverse()
}
