/* What the band draws and how it jumps back, decided as pure functions over
   the session's transcript and the rows the engine drew of it.

   The band draws the prompts the current session's transcript holds, and
   nothing else: never the archive, never another session's. A Jump Target is
   a drawn row's `requestId`: it lives in this module instance's memory only,
   and is good only while the transcript draws that row. */

import { COMPACTION_SUMMARY_OPENING, isPersonRow } from './branch'

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

/* Engine markup a `user` row opens on when the person did not write it as a
   prompt: a slash command and its output, a shell escape, an interruption,
   a note the engine adds. */
const ENGINE_ROW = /^(?:<(?:command-name|command-message|command-args|local-command-[a-z-]+|bash-input|bash-stdout|bash-stderr|system-reminder|task-notification)>|\[Request interrupted by user)/

/* The person's prompts the session's transcript holds, oldest first: what the
   band draws, read from `$.session.messages()` and nothing else. A tool
   result, the compaction summary and engine markup are not prompts. */
export function transcriptPrompts(
  messages: readonly { role: string; text: string; toolResults?: readonly unknown[] }[],
): string[] {
  return messages
    .filter(isPersonRow)
    .map(message => message.text)
    .filter(text => !text.startsWith(COMPACTION_SUMMARY_OPENING) && !ENGINE_ROW.test(text.trimStart()))
}

/* Which drawn row each prompt is, by its `requestId`: the drawn rows are
   walked in order, each prompt taking the next one with its text. A prompt
   no drawn row matches (the engine has not drawn it, or drew it unlike its
   stored text) has none, and the walk stays where it was. */
export function promptTargets(
  prompts: readonly string[],
  rows: readonly DrawnRow[],
): (string | undefined)[] {
  let from = 0
  return prompts.map(text => {
    const at = rows.findIndex((row, index) => index >= from && row.text === text)
    if (at < 0) return undefined
    from = at + 1
    return rows[at]!.requestId
  })
}

/* What a jump leaves behind: the engine scrolled there, and the band folds
   away; it refused, so the row is gone and the entry can no longer be jumped
   to; or the call itself failed (`undefined`), which proves nothing about the
   row, and nothing changes. */
export function jumpOutcome(result: { deny?: string } | undefined): 'collapse' | 'stale' | 'keep' {
  if (result === undefined) return 'keep'
  return result.deny === undefined ? 'collapse' : 'stale'
}
