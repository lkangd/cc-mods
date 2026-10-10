/* Reading the transcript file's text into rows. The file is JSON Lines in a
   format Claude Code does not publish; a line that is not a JSON object is
   counted, never guessed at. */

/* One line of the transcript file, as far as chat-toc reads it. */
export type TranscriptRow = {
  uuid: string
  parentUuid?: string | null
  logicalParentUuid?: string | null
  type?: string
  subtype?: string
  isSidechain?: boolean
  isMeta?: boolean
  isCompactSummary?: boolean
  timestamp?: string
  origin?: { kind?: string } | null
  message?: { id?: string; role?: string; content?: unknown }
  content?: unknown
}

export type ParsedTranscript = {
  /* Rows that carry a uuid, in file order. */
  rows: TranscriptRow[]
  /* Lines that did not parse as a JSON object. */
  unreadable: number
}

export function parseTranscript(text: string): ParsedTranscript {
  const rows: TranscriptRow[] = []
  let unreadable = 0
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      unreadable += 1
      continue
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      unreadable += 1
      continue
    }
    const row = value as Partial<TranscriptRow>
    /* Rows without a uuid (summaries, queue records, snapshots) are not on
       any conversation chain. */
    if (typeof row.uuid === 'string') rows.push(row as TranscriptRow)
  }
  return { rows, unreadable }
}
