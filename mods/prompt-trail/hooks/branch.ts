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
  /* The Archive generation this branch was last staged in. A capture names
     it, and one meant for a generation since replaced stages nothing. */
  generation?: string
}

export type BranchCandidate = {
  eventId: string
  sequence: number
  runId: string
  /* Its number among the project's Prompt Entries, as the band shows it. */
  ordinal?: number
}

/* The helper's answer, as `branch-match` prints it. `prefer` places the stored
   parent it was given, so it can be named even outside the band's window. */
type BranchMatchPlace = {
  prefer?: { eventId: string; sequence: number; ordinal: number }
  /* The generation the rows were matched against; `null` when there is none. */
  generation?: string | null
}
export type BranchMatch =
  | ({ match: 'unique'; eventId: string; candidates: BranchCandidate[]; candidateCount: number } & BranchMatchPlace)
  | ({ match: 'none' | 'ambiguous'; candidates: BranchCandidate[]; candidateCount: number } & BranchMatchPlace)

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

/* `compacted` says compaction has cleared rows from this session's
   transcript, so rows it lacks prove nothing about where it was rewound to. */
export function settleBranch(
  stored: BranchState | undefined,
  found: BranchMatch,
  newBranchId: string,
  compacted: boolean,
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
     entry it proves, or leaves it for the person. A rewind only shortens the
     transcript, so one no compaction touched that reaches no archived entry
     was rewound to its root. */
  if (found.match === 'none' && !compacted) {
    return { kind: 'set', state: { version: 1, branchId: newBranchId, parentEventId: null } }
  }
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

/* A `user` row the person wrote: a tool result is the engine's. */
export function isPersonRow(message: TranscriptMessage): boolean {
  return message.role === 'user' && (message.toolResults?.length ?? 0) === 0
}

/* Rows as `branch-match` reads them, oldest first, each as
   `<bytes>\n<text>`, and which of `texts` each line is. A text too long to
   have been archived could never match and is left out. When the rows run
   past what the helper reads, the oldest go and the input is marked
   truncated: its earliest rows are not all there. */
export function matchInput(
  texts: readonly string[],
): { stdin: string; truncated: boolean; indices: number[] } {
  const encoder = new TextEncoder()
  let truncated = false
  const kept: string[] = []
  const indices: number[] = []
  let bytes = 0
  for (let index = texts.length - 1; index >= 0; index -= 1) {
    const text = texts[index]!
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

/* The transcript's `user` rows as `branch-match` reads them. A tool result
   is the engine's, not the person's. A transcript at the engine's own limit
   is truncated just as one past the helper's is. */
export function transcriptRows(
  messages: readonly TranscriptMessage[],
): { stdin: string; truncated: boolean } {
  const { stdin, truncated } = matchInput(messages.filter(isPersonRow).map(message => message.text))
  return { stdin, truncated: truncated || messages.length >= TRANSCRIPT_ROW_LIMIT }
}

/* A person-side `user` row the transcript has to keep holding: its index
   among those rows and its text, or -1 for a transcript that held none.
   Held in memory only. */
export type TranscriptMark = { row: number; text: string }

function personRows(messages: readonly TranscriptMessage[]): TranscriptMessage[] {
  return messages.filter(isPersonRow)
}

/* The mark a prompt captured on top of `messages` leaves: the next
   person-side row is where it lands. Without one, the mark is the last row
   the transcript was settled against. */
export function markTranscript(
  messages: readonly TranscriptMessage[],
  text?: string,
): TranscriptMark {
  const rows = personRows(messages)
  if (text !== undefined) return { row: rows.length, text }
  const last = rows.at(-1)
  return last ? { row: rows.length - 1, text: last.text } : { row: -1, text: '' }
}

/* Whether the transcript still holds the marked prompt where it landed, so
   it can only have grown since and still ends on the same lineage. A rewind
   always removes the row it restores to. Past the engine's row limit the
   window slides and the index no longer holds. */
export function transcriptKept(
  messages: readonly TranscriptMessage[],
  mark: TranscriptMark,
): boolean {
  if (messages.length >= TRANSCRIPT_ROW_LIMIT) return false
  /* A transcript that held nothing cannot be rewound any further. */
  if (mark.row < 0) return true
  return personRows(messages)[mark.row]?.text === mark.text
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
  /* The folds that hold another Run rather than a branch of this one. */
  runs: Set<string>
}

/* The entries of `runId` that left its active path — the chain ending at
   `tip` — once that path began. Whatever this Run archived after the path's
   first entry and is not on it now is another branch: a stretch the
   transcript was rewound or resumed past, or a later segment the resumed
   session never saw. Entries before the path, and every other Run's, stay as
   they are. Each fold gathers the entries that leave the path at the same
   point, or that grow from the same root when they never touched it.

   Every other Run that entered a prompt once the path began was writing
   alongside this one: all it archived from then on — its boundaries too —
   folds into one place, at its first such event, counting its Prompt
   Entries. Before the path began, the project's history is drawn as it is.
   The archive is untouched; this only decides what is drawn folded.

   `rows` are a window over the timeline. `beyond`, when the archive placed
   the same tip, says which rows of the window the path crosses and where it
   began in this Run, which a tip or a start outside the window needs. Only
   entries inside the window are folded and counted. */
export function foldTimeline(
  rows: readonly ViewRow[],
  runId: string,
  tip: string | null,
  beyond?: { eventIds: ReadonlySet<string>; start: number | null },
): TimelineFolds {
  const folds: TimelineFolds = { folded: new Map(), counts: new Map(), runs: new Set() }
  const entries = new Map(
    rows.filter(row => row.kind === 'prompt').map(row => [row.eventId, row]),
  )
  const path = new Set<string>(
    [...beyond?.eventIds ?? []].filter(eventId => entries.has(eventId)),
  )
  for (let at = tip === null ? undefined : entries.get(tip); at; at = entries.get(at.parentEventId ?? '')) {
    path.add(at.eventId)
  }
  const own = [...path].map(eventId => entries.get(eventId)!).filter(row => row.runId === runId)
  const starts = [
    ...own.map(row => row.sequence),
    ...(beyond?.start != null ? [beyond.start] : []),
  ]
  if (starts.length === 0) return folds
  const start = Math.min(...starts)

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

  const alongside = new Map<string, ViewRow[]>()
  for (const row of rows) {
    if (row.runId === runId || row.sequence <= start || path.has(row.eventId)) continue
    const members = alongside.get(row.runId)
    if (members) members.push(row)
    else alongside.set(row.runId, [row])
  }
  for (const members of alongside.values()) {
    const prompts = members.filter(row => row.kind === 'prompt').length
    if (prompts === 0) continue
    const first = members.reduce((earliest, row) => (row.sequence < earliest.sequence ? row : earliest))
    for (const row of members) folds.folded.set(row.eventId, first.eventId)
    folds.counts.set(first.eventId, prompts)
    folds.runs.add(first.eventId)
  }

  const sequences = new Map(rows.map(row => [row.eventId, row.sequence]))
  const bySequence = ([left]: [string, unknown], [right]: [string, unknown]) =>
    sequences.get(left)! - sequences.get(right)!
  folds.counts = new Map([...folds.counts].sort(bySequence))
  folds.folded = new Map([...folds.folded].sort(bySequence))
  return folds
}

/* The Run each forked Run continues: its earliest entry in view hangs off an
   entry of another Run. `rows` come in sequence order, as the band draws them;
   a parent outside the window is placed by `beyond`, its Run by event id, or
   names nothing. */
export function forkSources(
  rows: readonly ViewRow[],
  beyond: ReadonlyMap<string, string> = new Map(),
): Map<string, string> {
  const entries = new Map(
    rows.filter(row => row.kind === 'prompt').map(row => [row.eventId, row]),
  )
  const sources = new Map<string, string>()
  const seen = new Set<string>()
  for (const row of entries.values()) {
    if (seen.has(row.runId)) continue
    seen.add(row.runId)
    const parentRun = entries.get(row.parentEventId ?? '')?.runId ?? beyond.get(row.parentEventId ?? '')
    if (parentRun !== undefined && parentRun !== row.runId) sources.set(row.runId, parentRun)
  }
  return sources
}

/* Entries that begin a new lineage part-way through their Run: a root it
   was rewound to (`root`), or an entry of another Run it was rewound onto
   (`cross-run`). A Run's first entry, and one drawn right after a boundary of
   its own Run, already have a line saying why they begin where they do; a
   parent in the same Run is a rewind the fold shows. A parent outside the
   window is placed by `beyond`, its Run by event id, or proves nothing.
   `rows` come in sequence order. */
export function branchStarts(
  rows: readonly ViewRow[],
  beyond: ReadonlyMap<string, string> = new Map(),
): Map<string, 'root' | 'cross-run'> {
  const entries = new Map(
    rows.filter(row => row.kind === 'prompt').map(row => [row.eventId, row]),
  )
  const starts = new Map<string, 'root' | 'cross-run'>()
  const previous = new Map<string, ViewRow>()
  for (const row of rows) {
    const before = previous.get(row.runId)
    previous.set(row.runId, row)
    if (row.kind !== 'prompt' || before === undefined || before.kind === 'boundary') continue
    if (row.parentEventId == null) {
      starts.set(row.eventId, 'root')
      continue
    }
    const parentRun = entries.get(row.parentEventId)?.runId ?? beyond.get(row.parentEventId)
    if (parentRun !== undefined && parentRun !== row.runId) starts.set(row.eventId, 'cross-run')
  }
  return starts
}
