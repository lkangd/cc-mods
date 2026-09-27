/* Tying Prompt Entries to the transcript rows that draw them, so the band can
   jump back to one, decided as pure functions over the rows drawn so far and
   the helper's answer.

   A Jump Target is a drawn row's `requestId`: it lives in this module
   instance's memory only, and is good only while the transcript draws that
   row. Which entry a row draws is never guessed from its text: the helper
   aligns the rows with the Active Branch's lineage and names a row only where
   every way the lineage fits them puts the same entry. */

import { TRANSCRIPT_ROW_LIMIT } from './branch'

/* One person's row the transcript drew, in the order rows were first drawn. */
export type DrawnRow = { requestId: string; text: string }

/* The helper archives prompts under 1 MiB and reads at most 64 MiB of rows. */
const ARCHIVED_TEXT_LIMIT = 1024 * 1024
const MATCH_INPUT_LIMIT = 64 * 1024 * 1024

/* Keeps a row the first time it is drawn; a redraw (a resize, a scroll, a
   reload replaying the transcript) keeps its place. A row the transcript
   has lost (`gone`) is not kept again: the engine may still draw it once on
   the way out. Answers whether it is new. */
export function recordRow(
  rows: DrawnRow[],
  gone: ReadonlySet<string>,
  requestId: string,
  text: string,
): boolean {
  if (gone.has(requestId) || rows.some(row => row.requestId === requestId)) return false
  rows.push({ requestId, text })
  return true
}

/* The drawn rows the transcript no longer holds, by `requestId`, given the
   texts of its person-side rows in order. A rewind or a clear only ever cuts
   the transcript short, so what it removed is the drawn rows past the last
   one still found there, each looked for after the one before. A row found
   nowhere with rows held after it is only drawn unlike its stored text (a
   paste, say), and stays. */
export function vanishedRows(rows: readonly DrawnRow[], held: readonly string[]): string[] {
  let from = 0
  let last = -1
  rows.forEach((row, index) => {
    const at = held.indexOf(row.text, from)
    if (at < 0) return
    from = at + 1
    last = index
  })
  return rows.slice(last + 1).map(row => row.requestId)
}

/* What `branch-match --rows` reads, oldest first as `<bytes>\n<text>`, and
   which drawn row each line of it is. A row too long to have been archived
   could never match and is left out. Past what the helper reads, the oldest
   rows go and the input is marked truncated: its earliest rows are not all
   there. */
export function alignmentInput(
  rows: readonly DrawnRow[],
): { stdin: string; truncated: boolean; indices: number[] } {
  const encoder = new TextEncoder()
  let truncated = false
  const kept: string[] = []
  const indices: number[] = []
  let bytes = 0
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const text = rows[index]!.text
    const length = encoder.encode(text).length
    if (length >= ARCHIVED_TEXT_LIMIT) continue
    const rowBytes = length + String(length).length + 1
    /* The helper refuses input that reaches its limit, not only past it. */
    if (kept.length === TRANSCRIPT_ROW_LIMIT || bytes + rowBytes >= MATCH_INPUT_LIMIT) {
      truncated = true
      break
    }
    bytes += rowBytes
    kept.push(`${length}\n${text}`)
    indices.push(index)
  }
  return { stdin: kept.reverse().join(''), truncated, indices: indices.reverse() }
}

/* Each entry the helper placed, and the `requestId` of the row it took;
   `indices` says which drawn row each line of the input was. A row gone
   from the transcript since is no target, whatever the helper says. */
export function jumpTargets(
  rows: readonly DrawnRow[],
  indices: readonly number[],
  aligned: readonly { row: number; eventId: string }[],
  gone: ReadonlySet<string> = new Set(),
): Map<string, string> {
  const targets = new Map<string, string>()
  for (const { row, eventId } of aligned) {
    const drawn = rows[indices[row] ?? -1]
    if (drawn && !gone.has(drawn.requestId)) targets.set(eventId, drawn.requestId)
  }
  return targets
}

/* What a jump leaves behind: the engine scrolled there, and the band folds
   away; it refused, so the row is gone and the entry can no longer be jumped
   to; or the call itself failed (`undefined`), which proves nothing about the
   row, and nothing changes. */
export function jumpOutcome(result: { deny?: string } | undefined): 'collapse' | 'stale' | 'keep' {
  if (result === undefined) return 'keep'
  return result.deny === undefined ? 'collapse' : 'stale'
}
