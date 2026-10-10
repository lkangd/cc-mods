/* The TOC's model kept up to date as the transcript file grows. Lines are
   read in file order, a slice at a time. When the new leaf walks back to the
   old chain's last row, the file only grew on the current branch: the chain
   is kept and only the last group, from its opener on, is grouped again.
   Anything else (a rewind's new branch, a row written again) groups the
   whole chain again. Either way the groups are the ones grouping the whole
   file at once gives, whatever rows open a group. */

import { chainIndex, indexRows, walkBack } from './chain'
import type { ChainIndex } from './chain'
import { groupTurns } from './groups'
import type { TurnGroup } from './groups'
import { parseTranscript } from './transcript'
import type { TranscriptRow } from './transcript'

export type Reading = {
  index: ChainIndex
  chain: TranscriptRow[]
  groups: TurnGroup[]
  /* Lines of the file chat-toc could not read as a row, so far. */
  unreadable: number
  /* How the last slice was grouped: only from the last group's opener on, or
     the whole chain. */
  lastRegroup: 'tail' | 'full' | undefined
}

export function newReading(): Reading {
  return { index: chainIndex(), chain: [], groups: [], unreadable: 0, lastRegroup: undefined }
}

/* Where the last group's opener sits on the chain; 0 when there is no group. */
function lastOpenerAt(reading: Reading): number {
  const opener = reading.groups[reading.groups.length - 1]?.openerUuid
  if (opener === undefined) return 0
  for (let i = reading.chain.length - 1; i >= 0; i--) {
    if (reading.chain[i]?.uuid === opener) return i
  }
  return 0
}

/* Reads the next whole lines of the file into the reading. */
export function readLines(reading: Reading, text: string): Reading {
  const { rows, unreadable } = parseTranscript(text)
  reading.unreadable += unreadable
  const isRewrite = indexRows(reading.index, rows)
  const oldLast = reading.chain[reading.chain.length - 1]?.uuid
  const walk = walkBack(reading.index, isRewrite ? undefined : oldLast)
  if (walk.isMet) {
    const from = lastOpenerAt(reading)
    for (const row of walk.rows) reading.chain.push(row)
    reading.groups = reading.groups.slice(0, -1).concat(groupTurns(reading.chain.slice(from)))
    reading.lastRegroup = 'tail'
  } else {
    reading.chain = walk.rows
    reading.groups = groupTurns(reading.chain)
    reading.lastRegroup = 'full'
  }
  return reading
}

/* Adds lines skipped without parsing, such as one longer than a chunk. */
export function countUnreadable(reading: Reading, lines: number): void {
  reading.unreadable += lines
}
