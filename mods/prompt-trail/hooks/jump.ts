/* Tying Prompt Entries to the transcript rows that draw them, so the band can
   jump back to one, decided as pure functions over the rows drawn so far and
   the helper's answer.

   A Jump Target is a drawn row's `requestId`: it lives in this module
   instance's memory only, and is good only while the transcript draws that
   row. Which entry a row draws is never guessed from its text: the helper
   aligns the rows with the Active Branch's lineage and names a row only where
   every way the lineage fits them puts the same entry. */

import { matchInput } from './branch'

/* One person's row the transcript drew, in the order rows were first drawn. */
export type DrawnRow = { requestId: string; text: string }

/* Keeps a row the first time it is drawn; a redraw (a resize, a scroll, a
   reload replaying the transcript) keeps its place. `seen` holds every row
   ever kept, the ones the transcript has since lost too: the engine may
   still draw one of those once on the way out, and it is not kept again.
   Answers whether it is new. */
export function recordRow(
  rows: DrawnRow[],
  seen: Set<string>,
  requestId: string,
  text: string,
): boolean {
  if (seen.has(requestId)) return false
  seen.add(requestId)
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
  const places = new Map<string, number[]>()
  held.forEach((text, at) => {
    const list = places.get(text)
    if (list) list.push(at)
    else places.set(text, [at])
  })
  let from = 0
  let last = -1
  rows.forEach((row, index) => {
    const list = places.get(row.text)
    if (!list) return
    let low = 0
    let high = list.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (list[middle]! < from) low = middle + 1
      else high = middle
    }
    if (low === list.length) return
    from = list[low]! + 1
    last = index
  })
  return rows.slice(last + 1).map(row => row.requestId)
}

/* What `branch-match --rows` reads, and which drawn row each line of it is. */
export function alignmentInput(
  rows: readonly DrawnRow[],
): { stdin: string; truncated: boolean; indices: number[] } {
  return matchInput(rows.map(row => row.text))
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
