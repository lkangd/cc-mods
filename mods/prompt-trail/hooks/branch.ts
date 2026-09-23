/* Rebuilding a Run's Active Branch after a resume or a fork, decided as pure
   functions over the stored branch state and what the transcript proves.

   The transcript's `user` rows go to the helper's `branch-match`, which names
   the archived Prompt Entry they end on; nothing here reads the archive or the
   store. A decision never guesses a parent: a transcript that proves one is
   followed, a stored lineage it contradicts is put to the person, and a new
   session whose shared history cannot be tied to one lineage starts from a
   root it marks as such rather than borrowing someone else's. */

/* The Active Branch one Run keeps for one classic session, in `$.store`.
   `explicitRoot` marks a root somebody chose (re-enabling collection, or
   answering "new root branch"), which a transcript must not overrule;
   `rootReason` says a fork's shared history matched several lineages, so the
   timeline can say the link was not made rather than imply there was none. */
export type BranchState = {
  version: 1
  branchId: string
  parentEventId: string | null
  explicitRoot?: true
  rootReason?: 'ambiguous-prefix'
}

export type BranchCandidate = {
  eventId: string
  sequence: number
  runId: string
}

/* The helper's answer, as `branch-match` prints it. */
export type BranchMatch =
  | { match: 'unique'; eventId: string; candidates: BranchCandidate[]; candidateCount: number }
  | { match: 'none' | 'ambiguous'; candidates: BranchCandidate[]; candidateCount: number }

export type BranchSettlement =
  | { kind: 'keep' }
  | { kind: 'set'; state: BranchState }
  /* `options` are event ids, the stored parent first; the person may also
     start a new root. The caller shows as many as its dialog holds. */
  | { kind: 'ask'; options: string[] }

/* Whether the stored state stands without asking the transcript at all. */
export function trustsStoredBranch(stored: BranchState | undefined): boolean {
  return stored?.explicitRoot === true && stored.parentEventId === null
}

export function settleBranch(
  stored: BranchState | undefined,
  found: BranchMatch,
  newBranchId: string,
): BranchSettlement {
  if (trustsStoredBranch(stored)) return { kind: 'keep' }
  const parent = stored?.parentEventId ?? null

  /* No lineage yet: a session that has archived nothing — a fork, a
     brand-new session, or one whose branch record a boundary created before
     any prompt. Whatever the transcript proves is where it starts. */
  if (parent === null) {
    const branch = stored?.branchId ?? newBranchId
    if (found.match === 'unique') {
      return { kind: 'set', state: { version: 1, branchId: branch, parentEventId: found.eventId } }
    }
    if (found.match === 'none') {
      return stored
        ? { kind: 'keep' }
        : { kind: 'set', state: { version: 1, branchId: branch, parentEventId: null } }
    }
    return {
      kind: 'set',
      state: {
        version: 1,
        branchId: branch,
        parentEventId: null,
        explicitRoot: true,
        rootReason: 'ambiguous-prefix',
      },
    }
  }

  /* A stored lineage: the transcript either confirms it, moves it to another
     entry it proves, or leaves it for the person. */
  if (found.match === 'unique') {
    return found.eventId === parent
      ? { kind: 'keep' }
      : { kind: 'set', state: { version: 1, branchId: newBranchId, parentEventId: found.eventId } }
  }
  const tied = found.candidates.map(candidate => candidate.eventId)
  if (found.match === 'ambiguous' && tied.includes(parent)) return { kind: 'keep' }
  return { kind: 'ask', options: [parent, ...tied.filter(eventId => eventId !== parent)] }
}

/* The person's answer to an `ask`: an event id from its options, or a new
   root. Keeping the stored parent keeps the branch it was on. */
export function chooseBranch(
  stored: BranchState | undefined,
  choice: string | 'root',
  newBranchId: string,
): BranchState {
  if (choice === 'root') {
    return { version: 1, branchId: newBranchId, parentEventId: null, explicitRoot: true }
  }
  if (stored && stored.parentEventId === choice) return stored
  return { version: 1, branchId: newBranchId, parentEventId: choice }
}

/* `$.session.messages()` answers at most its newest 4096 rows. */
export const TRANSCRIPT_ROW_LIMIT = 4096
/* The helper archives prompts under 1 MiB and reads at most 64 MiB of rows. */
const ARCHIVED_TEXT_LIMIT = 1024 * 1024
const MATCH_INPUT_LIMIT = 64 * 1024 * 1024

type TranscriptMessage = {
  role: string
  text: string
  toolResults?: readonly unknown[]
}

/* The `user` rows `branch-match` reads, oldest first, each as
   `<bytes>\n<text>`. A tool result is the engine's, not the person's; a row
   too long to have been archived could never match and is left out. When the
   rows run past what the helper reads, the oldest go, and the transcript is
   marked truncated just as one at the engine's own limit is: either way its
   earliest rows are not all there. */
export function transcriptRows(
  messages: readonly TranscriptMessage[],
): { stdin: string; truncated: boolean } {
  const encoder = new TextEncoder()
  let truncated = messages.length >= TRANSCRIPT_ROW_LIMIT
  const kept: string[] = []
  let bytes = 0
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!
    if (message.role !== 'user' || (message.toolResults?.length ?? 0) > 0) continue
    const length = encoder.encode(message.text).length
    if (length >= ARCHIVED_TEXT_LIMIT) continue
    const row = `${length}\n${message.text}`
    const rowBytes = length + String(length).length + 1
    /* The helper refuses input that reaches its limit, not only past it. */
    if (bytes + rowBytes >= MATCH_INPUT_LIMIT) {
      truncated = true
      break
    }
    bytes += rowBytes
    kept.push(row)
  }
  return { stdin: kept.reverse().join(''), truncated }
}

/* One timeline row as the view folds it. */
type ViewRow = {
  kind: 'prompt' | 'boundary'
  eventId: string
  sequence: number
  runId: string
  parentEventId?: string | null
}

export type TimelineFolds = {
  /* Each folded entry, and the fold it belongs to: the fold is named by its
     earliest entry, which is where the timeline draws it. */
  folded: Map<string, string>
  counts: Map<string, number>
}

/* The entries of `runId` that left its active path — the chain ending at
   `tip` — once that path began. Whatever this Run archived after the path's
   first entry and is not on it now is another branch: a stretch the
   transcript was rewound or resumed past, or a later segment the resumed
   session never saw. Entries before the path, and every other Run's, stay as
   they are. Each fold gathers the entries that leave the path at the same
   point, or that grow from the same root when they never touched it. The
   archive is untouched; this only decides what is drawn folded. */
export function foldTimeline(
  rows: readonly ViewRow[],
  runId: string,
  tip: string | null,
): TimelineFolds {
  const folds: TimelineFolds = { folded: new Map(), counts: new Map() }
  const entries = new Map(
    rows.filter(row => row.kind === 'prompt').map(row => [row.eventId, row]),
  )
  const path = new Set<string>()
  for (let at = tip === null ? undefined : entries.get(tip); at; at = entries.get(at.parentEventId ?? '')) {
    path.add(at.eventId)
  }
  const own = [...path].map(eventId => entries.get(eventId)!).filter(row => row.runId === runId)
  if (own.length === 0) return folds
  const start = Math.min(...own.map(row => row.sequence))

  const anchors = new Map<string, ViewRow[]>()
  for (const row of entries.values()) {
    if (row.runId !== runId || path.has(row.eventId) || row.sequence <= start) continue
    let top = row
    for (let up = entries.get(row.parentEventId ?? ''); up && !path.has(up.eventId); up = entries.get(up.parentEventId ?? '')) {
      top = up
    }
    const parent = top.parentEventId ?? ''
    const anchor = path.has(parent) ? `at:${parent}` : `root:${top.eventId}`
    const members = anchors.get(anchor)
    if (members) members.push(row)
    else anchors.set(anchor, [row])
  }
  for (const members of anchors.values()) {
    const first = members.reduce((earliest, row) => (row.sequence < earliest.sequence ? row : earliest))
    for (const row of members) folds.folded.set(row.eventId, first.eventId)
    folds.counts.set(first.eventId, members.length)
  }
  folds.counts = new Map(
    [...folds.counts].sort(([left], [right]) => entries.get(left)!.sequence - entries.get(right)!.sequence),
  )
  folds.folded = new Map(
    [...folds.folded].sort(([left], [right]) => entries.get(left)!.sequence - entries.get(right)!.sequence),
  )
  return folds
}

/* The Run each forked Run continues: its earliest entry in view hangs off an
   entry of another Run. `rows` come in sequence order, as the band draws them;
   a parent outside the loaded window names nothing. */
export function forkSources(rows: readonly ViewRow[]): Map<string, string> {
  const entries = new Map(
    rows.filter(row => row.kind === 'prompt').map(row => [row.eventId, row]),
  )
  const sources = new Map<string, string>()
  const seen = new Set<string>()
  for (const row of entries.values()) {
    if (seen.has(row.runId)) continue
    seen.add(row.runId)
    const parent = entries.get(row.parentEventId ?? '')
    if (parent && parent.runId !== row.runId) sources.set(row.runId, parent.runId)
  }
  return sources
}
