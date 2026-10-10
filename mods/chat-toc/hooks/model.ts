/* The TOC's model of the transcript: the file's text, through the current
   chain, to Turn groups. */

import { currentChain } from './chain'
import { groupTurns } from './groups'
import type { TurnGroup } from './groups'
import { parseTranscript } from './transcript'

export type TocModel = {
  groups: TurnGroup[]
  /* Lines of the file chat-toc could not read as a row. */
  unreadable: number
}

export const EMPTY_MODEL: TocModel = { groups: [], unreadable: 0 }

export function tocModel(text: string): TocModel {
  const { rows, unreadable } = parseTranscript(text)
  return { groups: groupTurns(currentChain(rows)), unreadable }
}
