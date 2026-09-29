import type {
  EngineInterface,
  PromptSubmitInput,
  PromptSubmitResult,
  Register,
  SessionMessage,
} from 'claude-code'
import { EXPECTED_HELPER_SHA256, HELPER_PROTOCOL } from './artifact'
import type { BranchMatch, BranchState, TranscriptMark } from './branch'
import { EARLIER_HINT_KEY, TITLE_KEY, arrowStep } from './band'
import { clipCells, textCells } from './cells'
import type { DrawnRow } from './jump'
import { alignmentInput, jumpOutcome, jumpTargets, recordRow, vanishedRows } from './jump'
import {
  branchStarts,
  chooseBranch,
  foldTimeline,
  forkSources,
  isPersonRow,
  markTranscript,
  settleBranch,
  transcriptKept,
  transcriptRows,
  trustsStoredBranch,
} from './branch'
import { gitToplevelArgv, projectRootFrom } from './project'
import type {
  Attachment,
  GapReason,
  LifecycleEvent,
  LifecycleState,
  LifecycleWrite,
  OwedGap,
} from './lifecycle'
import {
  GAP_REASONS,
  LIFECYCLE_QUEUE_CAPACITY,
  landGap,
  lossReasons,
  oweGap,
  settleGap,
  attachRun,
  attachmentOpening,
  clearTransitionState,
  decideLifecycle,
  dequeueLifecycleWrite,
  detachAbandoned,
  emptyLifecycle,
  queueLifecycleWrite,
  stayAttached,
} from './lifecycle'

type StartupState = {
  support: 'checking' | 'supported' | 'unsupported target' | 'helper unavailable'
  reason: string
  detected: string
  projectPath?: string
  databaseRoot?: string
  helperPath?: string
  locatorPath?: string
  sessionId?: string
  runId?: string
  archiveGeneration?: string
  /* When the Run's host process began, in milliseconds. It is the instant the
     Run's start boundary records, and it is the same on every reload and every
     replay of that boundary, as its idempotency requires. */
  hostStartedAt?: number
  /* This host process generation, `<pid>-<start seconds>-<start µs>`: what
     tells this process's attachment to a Run from another process's. */
  hostGeneration?: string
  /* The session this one continues: the conversation was moved here from it,
     and this session took up its Run and the branch it was on. */
  continuedFrom?: string
  helperTrusted?: true
}

type ConsentDecision = 'enabled' | 'declined'

type ProjectState = {
  root: string
  id: string
  databasePath?: string
  consent?: ConsentDecision
  archiveReady: boolean
}

type CollectionBoundaryKind =
  | 'collection-started'
  | 'collection-stopped'
  | 'collection-resumed'

/* Every non-prompt Timeline Event the plugin writes. A Clear Boundary is not a
   Collection Boundary: it records where a Conversation Segment ended, not
   whether a Run was recording; a Run boundary records where a Run first
   appeared, or where a process took it up again or left it; an Integrity gap
   where a Run's records stopped being provable, and its recovery where they
   became provable again. They share the table, the project-level sequence and
   the drawing of one row, and nothing else. */
type BoundaryKind =
  | CollectionBoundaryKind
  | 'clear'
  | 'run-started'
  | 'run-attached'
  | 'run-detached'
  | 'archive-quarantined'
  | 'integrity-gap'
  | 'integrity-recovery'

/* The Run-level switch, persisted per project and Run so an explicit disable
   survives a module reload. A Run with no record collects by default; only
   `/prompt-history disable` turns the switch off. */
type RunModeState = {
  version: 1
  mode: 'enabled' | 'disabled'
  boundary?: {
    kind: CollectionBoundaryKind
    eventId: string
    sequence: number
  }
  /* Set when disable could not write its stop boundary. The archive then has
     no durable record of where collection ended, so resuming would leave a
     resume boundary with no matching stop and misrepresent the gap. */
  stopBoundaryMissing?: true
}

/* A Pending Capture whose outcome is not known: the submission entered the
   session but its confirmation never landed. It is persisted per project
   rather than per Run, because the pending lives in the project's archive and
   a restart into a new Run still owes an answer for it. It carries identity
   only; the draft never enters `$.store`. */
type ReconcileState = {
  version: 1
  eventId: string
  runId: string
  branchId: string
  parentEventId: string | null
  attachmentCount: number
  /* The generation the pending was staged in, when known. */
  generation?: string
}

/* One row of the expanded band. Rows read back from the archive and rows this
   module instance appended are the same shape; neither carries a Jump Target,
   which only a live transcript position can give. */
type TimelineItem =
  | {
    kind: 'prompt'
    eventId: string
    sequence: number
    runId: string
    segmentId?: string
    branchId?: string
    parentEventId?: string | null
    text: string
    attachmentCount: number
    /* Its place among the project's Prompt Entries: the number the band
       shows, the same whichever batch holds it. */
    ordinal: number
  }
  | {
    kind: 'boundary'
    eventId: string
    sequence: number
    runId: string
    segmentId?: string
    boundary: BoundaryKind
  }

type RuntimeTarget = {
  isInteractive: boolean
  surface: string | null
  cwd: string
}

type Locator = {
  locatorVersion: 1
  pluginProtocol: 1
  helperProtocol: number
  sessionId: string
  hostPid: number
  hostStartSeconds: number
  hostStartMicroseconds: number
  hostExecutable: string
  hostVersion: string
  pluginRoot: string
  pluginData: string
  databaseRoot: string
  helperPath: string
  manifestPath: string
  helperSha256: string
  artifactStatus: string
  runId: string
  archiveGeneration: string
  continuedFrom?: string
}

type FileIdentity = {
  kind: string
  owner: number
  mode: number
}

type HelperPreflight = {
  status: 'supported'
  artifactStatus: 'trusted'
  sessionId: string
  runId: string
  archiveGeneration: string
  databaseRoot: string
  helperPath: string
  helperProtocol: number
  macosVersion: string
  sqliteVersionNumber: number
  sqliteReturning: true
}

const MINIMUM_CLAUDE_VERSION = [2, 1, 273] as const
const MINIMUM_CLAUDE_VERSION_TEXT = MINIMUM_CLAUDE_VERSION.join('.')
const COLLECTION_POLICY_VERSION = 1
const TARGET = `macOS 15.x arm64 · Claude Code >=${MINIMUM_CLAUDE_VERSION_TEXT} · interactive terminal`
/* What the release does not promise, by name only; the README says each in full. */
const NOT_PROMISED =
  '其他平台与 surface · Marketplace 安装与卸载 · 自动焦点、Esc 折叠、触控板与滚轮、槽位仲裁 · 删除不触及 transcript 与外部副本 · 移除 --plugin-dir 前先清除（见 README）'
const LOCATOR_SUFFIX = '.claude/plugins/data/.function-hook-locators/prompt-trail'
const SAFE_IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/
const SAFE_ERROR_CATEGORIES = new Set([
  'architecture',
  'archive-busy',
  'archive-full',
  'archive-generation',
  'archive-integrity',
  'archive-read-only',
  'archive-sqlite',
  'boundary-conflict',
  'boundary-input',
  'capture-conflict',
  'capture-input',
  'clear-input',
  'clear-unfinished',
  'clear-run-quarantined',
  'clear-run-unfinished',
  'match-input',
  'archive-memory',
  'capture-not-found',
  'capture-parent-unknown',
  'claude-code-version',
  'claude-code-version-unproven',
  'database-path',
  'database-permissions',
  'database-root',
  'database-root-permissions',
  'database-root-unavailable',
  'database-unavailable',
  'digest-mismatch',
  'expected-digest-invalid',
  'helper-hash-unproven',
  'helper-missing',
  'helper-not-executable',
  'helper-not-regular',
  'helper-path',
  'helper-path-mismatch',
  'helper-path-unproven',
  'home-unavailable',
  'helper-untrusted',
  'host-executable',
  'host-generation',
  'locator-directory',
  'locator-digest-mismatch',
  'locator-directory-permissions',
  'locator-identifiers',
  'locator-path',
  'locator-permissions',
  'locator-protocol-mismatch',
  'locator-schema',
  'locator-session',
  'macos-major-version',
  'macos-version-unproven',
  'manifest-invalid',
  'manifest-missing',
  'manifest-path',
  'manifest-untrusted',
  'migration-backup',
  'migration-backup-cleanup',
  'migration-verify',
  'operating-system',
  'operating-system-unproven',
  'plugin-artifacts-untrusted',
  'plugin-bin-untrusted',
  'plugin-data-permissions',
  'plugin-root-untrusted',
  'project-identity',
  'read-input',
  'protocol-mismatch',
  'quarantine-failed',
  'schema-version',
  'sqlite-capability',
])
/* Failures of the archive itself, which every Run using it meets; anything
   else (the locator, the helper, this process's identity or store) is the
   affected Run's alone. */
const SHARED_FAILURES = new Set([
  'archive-busy',
  'archive-full',
  'archive-integrity',
  'archive-read-only',
  'archive-sqlite',
  'database-path',
  'database-permissions',
  'database-root',
  'database-root-permissions',
  'database-root-unavailable',
  'database-unavailable',
  'migration-backup',
  'migration-backup-cleanup',
  'migration-verify',
  'project-identity',
  'quarantine-failed',
  'clear-unfinished',
  'clear-run-unfinished',
  'schema-version',
])
/* Damage to the archive, or a quarantine of it left unfinished: beside
   disabling the Run, the person may check it again or quarantine it. */
const DAMAGE_FAILURES = new Set(['archive-integrity', 'quarantine-failed'])
/* What the plugin itself names a failure it met, beside the helper's own
   categories. Nothing else a failure carries is ever shown. */
const PLUGIN_FAILURES = new Set([
  'clear-all',
  'clear-inventory',
  'clear-run',
  'boundary-append',
  'boundary-response',
  'branch-match',
  'capture-abort',
  'capture-begin',
  'capture-confirm',
  'capture-identity',
  'capture-list',
  'capture-response',
  'category-unrecorded',
  'database-root-unproven',
  'helper-call-failed',
  'inflight-unreadable',
  'inflight-unrecorded',
  'lifecycle-write',
  'preflight-failed',
  'project-root-unproven',
  'run-mode-unreadable',
  'store-unavailable',
  'timeline-read',
  'transcript-unreadable',
])
const RETRYABLE_LOCATOR_REASONS = new Set([
  'claude-code-version-unproven',
  'locator-directory-permissions',
  'locator-permissions',
])

let startup: StartupState = {
  support: 'checking',
  reason: 'preflight-pending',
  detected: 'not checked',
}
let runtimeTarget: RuntimeTarget | undefined
let project: ProjectState | undefined
let expanded = false
/* The band's window over the Project Timeline, in sequence order: at most
   WINDOW_LIMIT events, never the whole archive. `earlier` and `later` say
   events lie beyond it; a window without the latest events has `later`. */
let timeline: TimelineItem[] = []
let timelineEdges = { earlier: false, later: false }
/* What the view derives from events outside the window, as the helper
   answered it: the Run of each parent the window lacks, the Run that held a
   Run start's segment first, and the Active Branch where it crosses the
   window and where it began in this Run. */
let parentRuns = new Map<string, string>()
let segmentOrigins = new Map<string, string>()
let activePath: { tip: string; eventIds: Set<string>; start: number | null } | undefined
/* Prompt Entries this process added while the person was looking elsewhere
   in the band, cleared once the band is back at its bottom. */
let unread = 0
let windowLoading = false
/* The band draws its own window over its rows, under a title that stays put:
   the row shown first, kept by key so a batch arriving above or below leaves
   the view where it was (its index is the fallback when that row is gone),
   and whether the view rests on the last row, where new entries are
   followed. */
let bandTop = 0
let bandAnchor: string | undefined
let bandBottom = true
/* What the last drawing showed: its instance, every row's key, the rows the
   focus can stop on, how many rows a scrolling view shows under the title,
   those shown, and whether the tree fitted the band (nothing below the view,
   so the engine scrolls nothing and walks the ring itself). */
let bandView: {
  requestId?: string
  rowKeys: string[]
  stops: string[]
  capacity: number
  shown: string[]
  fits: boolean
} = { rowKeys: [], stops: [], capacity: 1, shown: [], fits: true }
/* The band element holding its focus ring, as the last move left it, and a
   row the ring moves to once the next drawing shows it. */
let ringKey: string | undefined
let pendingFocus: string | undefined
/* Whether the band last drew too small for its rows (under 28 columns or 6
   rows), and the element its ring stood on then, to return to with room. */
let cramped = false
let crampedRing: string | undefined
/* The title row's word on giving the band the keyboard, and the fewest cells
   its way up is cut to (`↑ 点…`). */
const FOCUS_HINT = 'ctrl+x tab 键盘选择'
/* Said on the title row while this Run collects and cannot, so a failure
   another Run found shows before the next submission meets it. */
const UNAVAILABLE_MARK = '档案不可用'
const UP_MIN_CELLS = 5
/* AskUserQuestion dialogs now open, and whether the host's last drawing of
   the band had a survey holding it: the band gives way to either, and leaves
   the slot's scrolling and focus to them meanwhile. */
let dialogs = 0
let surveyHeld = false
/* Archive unavailable as this Run knows it. A shared failure is also on
   record for the project's other Runs and stops a submission before it tries
   (`blocking`); a Run-local one only reports, and the next submission tries
   for real. `elsewhere` is a record another Run wrote. */
type Unavailable = {
  scope: 'run' | 'archive'
  category: string
  elsewhere: boolean
  blocking: boolean
  /* The generation found damaged, when the failure is damage. */
  generation?: string
  /* What the latest recheck of a damaged archive found. */
  recheck?: Recheck
  /* The Run a Run-local failure belongs to; another Run this process moves
     to does not inherit it. */
  runId?: string
}
let archiveFailure: Unavailable | undefined
/* The generation the latest `archive-integrity` failure named. */
let damagedGeneration: string | undefined
/* What `archive-status` last said of the project's archive, for `status`. */
let archiveStatus: ArchiveStatus | undefined
/* What the latest staged capture said about the archive's disk. */
let diskSpace: 'low' | 'ok' | 'unknown' = 'unknown'
/* Runs this module instance has warned of low disk space. */
const spaceWarned = new Set<string>()
let runMode: { key: string; value: RunModeState } | undefined
/* `text` is present only while the module instance that staged the capture is
   still loaded; after a restart the staged bytes in the archive are the only
   copy of the prompt, and the helper confirms from them without handing them
   back. */
let reconcile: { state: ReconcileState; text?: string } | undefined
/* One archive-side discovery per Run: a restart has to learn that a pending is
   owed, but a healthy Run must not pay for a subprocess on every prompt. */
let pendingDiscovered = false
/* Set when the archive could not say whether anything is owed. Not knowing is
   not the same as nothing being owed, and status says so. */
let pendingUnknown: string | undefined
/* How many pendings of other, live Runs the archive held at the latest
   listing; `status` lists again, so it never reports a stale count. */
let pendingElsewhere: number | undefined
/* The Conversation Segment lifecycle for the current project: the latest
   `/clear` transition and the Clear Boundaries the archive still owes. Kept per
   project rather than per Run, because a lifecycle write that never landed is
   still owed by the next process. */
let lifecycle: { key: string; value: LifecycleState } | undefined
/* Why the last Clear Boundary write did not land, as the helper categorised it.
   Run-local and never persisted: it explains a queue that will not drain, and
   `$.store` is for facts the next process still owes, not for diagnostics. */
let lifecycleFailure: string | undefined
/* A `/clear` that was seen but could not be turned into a durable write — the
   branch it cuts was unreadable, or the queue could not be saved. The instant
   is taken once and kept, so completing it later replays the same boundary
   rather than a drifted one. It blocks this Run's next composer submission,
   and every drain tries to finish it. */
let deferredClear: {
  sessionId: string
  occurredAt: number
  generation: string | null
  /* The in-flight marker that says it is held: it goes once it is queued. */
  marker?: string
} | undefined
/* The calls of this module instance still running: an in-flight marker of any
   other call is one whose hook stopped without clearing it. */
const liveCalls = new Set<string>()
/* How many of this Run's calls stopped without clearing their marker, as
   status last counted them. */
let unsettledCalls = 0
/* What the project's other Runs still owe, as the last enumeration found it.
   Kept for the report only; the drain always re-enumerates. */
/* The Run and classic session whose Active Branch this module instance has
   already settled against the transcript, and where the last prompt captured
   there landed (or the transcript stood when it was settled). While the
   transcript still holds that row, nothing was rewound and the next
   submission needs no match. A reload settles it once more, which is
   harmless: by then the transcript confirms what is stored. Its text never
   leaves this module instance. */
let transcriptMark: { key: string; mark: TranscriptMark } | undefined
/* Classic sessions this module instance saw compacted and could not yet
   record: the store write failed, or there was no project to key it by. */
const compactedSessions = new Set<string>()
/* Sessions compacted since their last alignment. Compaction rewrites the
   transcript but not the lineage, so the next submission takes the
   compacted transcript as its baseline instead of reading it as a rewind. */
const recompacted = new Set<string>()
/* The project whose archived events this module instance has read back, and
   the session it already waited on for a late locator. */
/* The generation the window's events were read from. */
let viewGeneration: string | null | undefined
let timelineLoaded: string | undefined
let locatorAwaited: string | undefined
/* The current session's Active Branch as last read or written, which is what
   the band folds against; and the branches that began from a root because a
   fork's shared history matched several lineages. Both only shape the view. */
let activeBranch: { key: string; value: BranchState } | undefined
const ambiguousRoots = new Set<string>()
/* The person's rows the transcript drew, in the order first drawn, and the
   Jump Target of each Prompt Entry the helper tied to one: the row's
   `requestId`, in memory only. A row the transcript lost (a rewind, a clear,
   a row the engine would not scroll to) is gone, and never kept or tied
   again. The generation moves whenever the transcript starts over, so an
   alignment asked of the old rows cannot land on the new ones; one asked
   while another runs is run again once it ends. */
let drawnRows: DrawnRow[] = []
let seenRows = new Set<string>()
let goneRows = new Set<string>()
let jumpTable = new Map<string, string>()
let drawnGeneration = 0
let alignmentQueued = false
let alignment: { again: boolean } | undefined
/* A rewind says nothing and draws nothing: while the band is open, a
   drawing asks the transcript again at once, and once more this long after,
   in case the transcript was cut short a moment later; drawings in between
   wait for that follow-up. */
const RECHECK_INTERVAL = 500
let recheckQueued = false
/* The folds the person opened, by the entry each is drawn at. */
const openFolds = new Set<string>()
/* A parent the transcript could not place, waiting on the person in its Pane:
   the branch it settles, what it may be settled to, and the draft of the
   submission it dropped. The draft never leaves this module instance; a
   reload forgets it, and the next submission asks again. */
type ParentChoice = {
  key: string
  sessionId: string
  stored: BranchState | undefined
  /* The generation the candidates were matched in. */
  generation?: string
  candidates: { eventId: string; label: string }[]
  unlisted: number
  mark: TranscriptMark
  draft: string
  settling?: true
  error?: string
}
let parentChoice: ParentChoice | undefined
let lifecycleOthers: { queue: LifecycleWrite[]; unfinished: number } | undefined

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function supportsClaudeVersion(value: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value)
  if (!match) return false
  const version = match.slice(1).map(component => Number.parseInt(component, 10))
  if (version.some(component => !Number.isSafeInteger(component))) return false
  for (let index = 0; index < MINIMUM_CLAUDE_VERSION.length; index += 1) {
    const component = version[index] ?? 0
    const minimum = MINIMUM_CLAUDE_VERSION[index] ?? 0
    if (component !== minimum) return component > minimum
  }
  return true
}

function requiredString(
  value: Record<string, unknown>,
  key: string,
): string {
  const field = value[key]
  if (typeof field !== 'string' || field.includes('\0')) {
    throw new Error(`locator-schema:${key}`)
  }
  return field
}

function requiredInteger(
  value: Record<string, unknown>,
  key: string,
): number {
  const field = value[key]
  if (!Number.isSafeInteger(field)) throw new Error(`locator-schema:${key}`)
  return field as number
}

function parseLocator(text: string): Locator {
  const value: unknown = JSON.parse(text)
  if (!isRecord(value)) throw new Error('locator-schema')
  const locator = {
    locatorVersion: requiredInteger(value, 'locatorVersion'),
    pluginProtocol: requiredInteger(value, 'pluginProtocol'),
    helperProtocol: requiredInteger(value, 'helperProtocol'),
    sessionId: requiredString(value, 'sessionId'),
    hostPid: requiredInteger(value, 'hostPid'),
    hostStartSeconds: requiredInteger(value, 'hostStartSeconds'),
    hostStartMicroseconds: requiredInteger(value, 'hostStartMicroseconds'),
    hostExecutable: requiredString(value, 'hostExecutable'),
    hostVersion: requiredString(value, 'hostVersion'),
    pluginRoot: requiredString(value, 'pluginRoot'),
    pluginData: requiredString(value, 'pluginData'),
    databaseRoot: requiredString(value, 'databaseRoot'),
    helperPath: requiredString(value, 'helperPath'),
    manifestPath: requiredString(value, 'manifestPath'),
    helperSha256: requiredString(value, 'helperSha256'),
    artifactStatus: requiredString(value, 'artifactStatus'),
    runId: requiredString(value, 'runId'),
    archiveGeneration: requiredString(value, 'archiveGeneration'),
    ...('continuedFrom' in value
      ? { continuedFrom: requiredString(value, 'continuedFrom') }
      : {}),
  }
  if (locator.locatorVersion !== 1 || locator.pluginProtocol !== 1) {
    throw new Error('locator-schema')
  }
  return locator as Locator
}

function parseHelperPreflight(text: string): HelperPreflight {
  const value: unknown = JSON.parse(text)
  if (!isRecord(value)) throw new Error('preflight-response')
  if (
    value.status !== 'supported' ||
    value.artifactStatus !== 'trusted' ||
    typeof value.sessionId !== 'string' ||
    typeof value.runId !== 'string' ||
    typeof value.archiveGeneration !== 'string' ||
    typeof value.databaseRoot !== 'string' ||
    typeof value.helperPath !== 'string' ||
    !Number.isSafeInteger(value.helperProtocol) ||
    typeof value.macosVersion !== 'string' ||
    !Number.isSafeInteger(value.sqliteVersionNumber) ||
    value.sqliteReturning !== true
  ) {
    throw new Error('preflight-response')
  }
  return value as HelperPreflight
}

async function run(
  $: EngineInterface,
  argv: readonly string[],
  timeoutMs = 5_000,
  stdin?: string,
) {
  return $.process.run(argv, { timeoutMs, ...(stdin === undefined ? {} : { stdin }) })
}

/* A helper call on the archive. One the host killed at its time limit, or
   could not start, rejects in the host's own words, which are never shown and
   do not say which it was: it is named `helper-call-failed`. */
async function runArchive(
  $: EngineInterface,
  argv: readonly string[],
  timeoutMs: number,
  stdin?: string,
) {
  try {
    return await run($, argv, timeoutMs, stdin)
  } catch {
    throw new Error('helper-call-failed')
  }
}

async function runText(
  $: EngineInterface,
  argv: readonly string[],
): Promise<string | undefined> {
  const result = await run($, argv)
  if (result.exitCode !== 0) return undefined
  const text = result.stdout.trim()
  return text || undefined
}

async function realpath($: EngineInterface, path: string): Promise<string> {
  const canonical = await runText($, ['/bin/realpath', path])
  if (!canonical) throw new Error('path-unproven')
  return canonical
}

async function fileIdentity(
  $: EngineInterface,
  path: string,
  unavailableReason: string,
): Promise<FileIdentity> {
  const result = await run(
    $,
    ['/usr/bin/stat', '-f', '%HT|%u|%Lp', path],
  )
  if (result.exitCode !== 0) throw new Error(unavailableReason)
  const [kind, ownerText, modeText, extra] = result.stdout.trim().split('|')
  const owner = Number.parseInt(ownerText ?? '', 10)
  const mode = Number.parseInt(modeText ?? '', 8)
  if (
    extra !== undefined ||
    !kind ||
    !Number.isSafeInteger(owner) ||
    !Number.isSafeInteger(mode)
  ) {
    throw new Error(unavailableReason)
  }
  return { kind, owner, mode }
}

async function hasExtendedAcl(
  $: EngineInterface,
  path: string,
  unavailableReason: string,
): Promise<boolean> {
  const result = await run($, ['/bin/ls', '-lde', path])
  if (result.exitCode !== 0 || !result.stdout) throw new Error(unavailableReason)
  return result.stdout
    .split('\n')
    .slice(1)
    .some(line => /^\s*\d+:/.test(line))
}

function normalizedHome(home: string): string {
  if (!home.startsWith('/') || home.includes('\0')) throw new Error('home-unavailable')
  return home.length > 1 && home.endsWith('/') ? home.slice(0, -1) : home
}

function safeCategory(stderr: string, fallback: string): string {
  try {
    const parsed: unknown = JSON.parse(stderr)
    if (
      isRecord(parsed) &&
      typeof parsed.category === 'string' &&
      SAFE_ERROR_CATEGORIES.has(parsed.category)
    ) {
      /* Damage names the generation it was met in, which is the one a
         quarantine may move; it travels with the failure from here. */
      if (parsed.category === 'archive-integrity') {
        damagedGeneration = isSafeId(parsed.generation) ? parsed.generation : undefined
      }
      return parsed.category
    }
  } catch {
    // Diagnostics never repeat untrusted helper output.
  }
  return fallback
}

function unsupported(
  reason: string,
  detected: string,
  cwd: string,
  fields: Partial<StartupState> = {},
): StartupState {
  return {
    support: 'unsupported target',
    reason,
    detected,
    projectPath: cwd,
    ...fields,
  }
}

function unavailable(
  reason: string,
  detected: string,
  cwd: string,
  fields: Partial<StartupState> = {},
): StartupState {
  return {
    support: 'helper unavailable',
    reason,
    detected,
    projectPath: cwd,
    ...fields,
  }
}

async function inspectTarget(
  $: EngineInterface,
  isInteractive: boolean,
  surface: string | null,
  cwd: string,
): Promise<StartupState> {
  if (!isInteractive || surface !== 'terminal') {
    return unsupported(
      'interactive-terminal',
      `${surface ?? 'headless'} · ${isInteractive ? 'interactive' : 'non-interactive'}`,
      cwd,
    )
  }

  let os: string | undefined
  try {
    os = await runText($, ['/usr/bin/uname', '-s'])
  } catch {
    return unsupported('operating-system-unproven', 'unproven operating system', cwd)
  }
  if (!os) {
    return unsupported('operating-system-unproven', 'unproven operating system', cwd)
  }
  if (os !== 'Darwin') {
    return unsupported('operating-system', os, cwd)
  }

  let architecture: string | undefined
  try {
    architecture = await runText($, ['/usr/bin/uname', '-m'])
  } catch {
    return unsupported('architecture', `${os} unproven architecture`, cwd)
  }
  if (architecture !== 'arm64') {
    return unsupported(
      'architecture',
      `${os} ${architecture ?? 'unproven architecture'}`,
      cwd,
    )
  }

  let productVersion: string | undefined
  try {
    productVersion = await runText($, ['/usr/bin/sw_vers', '-productVersion'])
  } catch {
    return unsupported(
      'macos-version-unproven',
      `${os} ${architecture} unproven version`,
      cwd,
    )
  }
  if (!productVersion) {
    return unsupported(
      'macos-version-unproven',
      `${os} ${architecture} unproven version`,
      cwd,
    )
  }
  if (!productVersion.startsWith('15.')) {
    return unsupported(
      'macos-major-version',
      `${os} ${architecture} ${productVersion}`,
      cwd,
    )
  }

  const detectedPlatform = `macOS ${productVersion} ${architecture}`
  let home: string
  let sessionId: string
  try {
    home = normalizedHome((await $.env.get('HOME')) ?? '')
    sessionId = await $.session.id()
  } catch {
    return unsupported(
      'claude-code-version-unproven',
      `${detectedPlatform} · Claude Code version unproven`,
      cwd,
    )
  }
  if (!SAFE_IDENTIFIER.test(sessionId)) {
    return unsupported(
      'claude-code-version-unproven',
      `${detectedPlatform} · Claude Code version unproven`,
      cwd,
    )
  }

  /* One locator per process that has this session open, named after the
     process generation that published it. Which one is this process's own is
     for the helper to say — it knows its host process — so every candidate is
     inspected and the first one it vouches for is taken. */
  const locatorDirectory = `${home}/${LOCATOR_SUFFIX}`
  let candidates: string[] = []
  try {
    const ownName = new RegExp(`^${sessionId}\\.\\d+-\\d+-\\d+\\.json$`)
    candidates = (await $.fs.list(locatorDirectory))
      .filter(entry => entry.kind === 'file' && ownName.test(entry.name))
      .map(entry => `${locatorDirectory}/${entry.name}`)
      .sort()
  } catch {
    // Inspected below as a locator that is missing.
  }
  /* No bridge published anything for this session: the host never ran the
     classic hook that would have proven its version. */
  if (candidates.length === 0) {
    return unsupported(
      'claude-code-version-unproven',
      `${detectedPlatform} · Claude Code version unproven`,
      cwd,
      { sessionId },
    )
  }
  let refusal: StartupState | undefined
  for (const candidate of candidates) {
    const inspected = await inspectLocator(candidate)
    if (inspected.support === 'supported') return inspected
    refusal ??= inspected
  }
  return refusal as StartupState

  async function inspectLocator(locatorPath: string): Promise<StartupState> {
    let owner: number
    try {
      const ownerText = await runText($, ['/usr/bin/id', '-u'])
      owner = Number.parseInt(ownerText ?? '', 10)
      if (!Number.isSafeInteger(owner)) throw new Error('locator-permissions')
      const [locatorFile, locatorDir] = await Promise.all([
        fileIdentity($, locatorPath, 'claude-code-version-unproven'),
        fileIdentity($, locatorDirectory, 'locator-directory-permissions'),
      ])
      if (locatorFile.kind !== 'Regular File'
          || locatorFile.owner !== owner
          || locatorFile.mode !== 0o600) {
        throw new Error('locator-permissions')
      }
      if (locatorDir.kind !== 'Directory'
          || locatorDir.owner !== owner
          || locatorDir.mode !== 0o700) {
        throw new Error('locator-directory-permissions')
      }
      const [locatorAcl, locatorDirectoryAcl] = await Promise.all([
        hasExtendedAcl($, locatorPath, 'locator-permissions'),
        hasExtendedAcl($, locatorDirectory, 'locator-directory-permissions'),
      ])
      if (locatorAcl) throw new Error('locator-permissions')
      if (locatorDirectoryAcl) throw new Error('locator-directory-permissions')
      if (await realpath($, locatorPath) !== locatorPath) {
        throw new Error('locator-permissions')
      }
    } catch (error) {
      const reason = error instanceof Error && SAFE_ERROR_CATEGORIES.has(error.message)
        ? error.message
        : 'locator-permissions'
      return unsupported(
        reason,
        `${detectedPlatform} · Claude Code version unproven`,
        cwd,
        { locatorPath, sessionId },
      )
    }

    let locator: Locator
    try {
      locator = parseLocator(await $.fs.read(locatorPath))
    } catch {
      return unsupported(
        'claude-code-version-unproven',
        `${detectedPlatform} · Claude Code version unproven`,
        cwd,
        { locatorPath, sessionId },
      )
    }

    const commonFields = {
      locatorPath,
      sessionId,
      runId: locator.runId,
      archiveGeneration: locator.archiveGeneration,
      hostStartedAt: locator.hostStartSeconds * 1000
        + Math.floor(locator.hostStartMicroseconds / 1000),
      hostGeneration:
        `${locator.hostPid}-${locator.hostStartSeconds}-${locator.hostStartMicroseconds}`,
      helperPath: locator.helperPath,
      databaseRoot: locator.databaseRoot,
      ...(locator.continuedFrom === undefined ? {} : { continuedFrom: locator.continuedFrom }),
    }
    if (!supportsClaudeVersion(locator.hostVersion)) {
      const reason = /^\d+\.\d+\.\d+$/.test(locator.hostVersion)
        ? 'claude-code-version'
        : 'claude-code-version-unproven'
      return unsupported(
        reason,
        `${detectedPlatform} · Claude Code ${locator.hostVersion}`,
        cwd,
        commonFields,
      )
    }
    const detected = `${detectedPlatform} · Claude Code ${locator.hostVersion}`
    if (locator.sessionId !== sessionId) {
      return unavailable('locator-session', detected, cwd, commonFields)
    }
    if (!SAFE_IDENTIFIER.test(locator.runId)
        || !SAFE_IDENTIFIER.test(locator.archiveGeneration)
        || (locator.continuedFrom !== undefined
          && (!SAFE_IDENTIFIER.test(locator.continuedFrom)
            || locator.continuedFrom === sessionId))) {
      return unavailable('locator-identifiers', detected, cwd, commonFields)
    }
    if (locator.helperProtocol !== HELPER_PROTOCOL) {
      return unavailable('protocol-mismatch', detected, cwd, commonFields)
    }
    if (locator.helperSha256 !== EXPECTED_HELPER_SHA256) {
      return unavailable('locator-digest-mismatch', detected, cwd, commonFields)
    }
    if (locator.artifactStatus !== 'trusted') {
      const reason = SAFE_ERROR_CATEGORIES.has(locator.artifactStatus)
        ? locator.artifactStatus
        : 'artifact-untrusted'
      return unavailable(reason, detected, cwd, commonFields)
    }
    if (
      !locator.pluginRoot.startsWith('/') ||
      !locator.pluginData.startsWith('/') ||
      locator.helperPath !== `${locator.pluginRoot}/bin/prompt-trail-helper` ||
      locator.manifestPath !== `${locator.pluginRoot}/artifacts/helper-manifest.json` ||
      locator.databaseRoot !== `${locator.pluginData}/archives`
    ) {
      return unavailable('locator-path', detected, cwd, commonFields)
    }

    try {
      const pluginBin = `${locator.pluginRoot}/bin`
      const pluginArtifacts = `${locator.pluginRoot}/artifacts`
      const identities = await Promise.all([
        fileIdentity($, locator.pluginRoot, 'plugin-root-untrusted'),
        fileIdentity($, pluginBin, 'plugin-bin-untrusted'),
        fileIdentity($, pluginArtifacts, 'plugin-artifacts-untrusted'),
        fileIdentity($, locator.pluginData, 'plugin-data-permissions'),
        fileIdentity($, locator.helperPath, 'helper-missing'),
        fileIdentity($, locator.manifestPath, 'manifest-missing'),
      ])
      const [pluginRoot, pluginBinDirectory, pluginArtifactsDirectory, pluginData, helper, manifest] = identities
      for (const [identity, reason] of [
        [pluginRoot, 'plugin-root-untrusted'],
        [pluginBinDirectory, 'plugin-bin-untrusted'],
        [pluginArtifactsDirectory, 'plugin-artifacts-untrusted'],
      ] as const) {
        if (identity.kind !== 'Directory'
            || (identity.owner !== owner && identity.owner !== 0)
            || (identity.mode & 0o022) !== 0) {
          throw new Error(reason)
        }
      }
      if (pluginData.kind !== 'Directory' || pluginData.owner !== owner || pluginData.mode !== 0o700) {
        throw new Error('plugin-data-permissions')
      }
      if (helper.kind !== 'Regular File') throw new Error('helper-not-regular')
      if (helper.owner !== owner || (helper.mode & 0o022) !== 0) {
        throw new Error('helper-untrusted')
      }
      if ((helper.mode & 0o111) === 0) throw new Error('helper-not-executable')
      if (manifest.kind !== 'Regular File'
          || manifest.owner !== owner
          || (manifest.mode & 0o022) !== 0) {
        throw new Error('manifest-untrusted')
      }

      const canonicalChecks = [
        locator.pluginRoot,
        pluginBin,
        pluginArtifacts,
        locator.pluginData,
        locator.helperPath,
        locator.manifestPath,
      ]
      for (const path of canonicalChecks) {
        if (await realpath($, path) !== path) throw new Error('noncanonical-path')
      }

      const digest = await run(
        $,
        ['/usr/bin/shasum', '-a', '256', locator.helperPath],
      )
      const actualDigest = digest.exitCode === 0
        ? digest.stdout.trim().split(/\s+/, 1)[0]
        : undefined
      if (actualDigest !== EXPECTED_HELPER_SHA256) throw new Error('digest-mismatch')
    } catch (error) {
      const reason = error instanceof Error && SAFE_ERROR_CATEGORIES.has(error.message)
        ? error.message
        : error instanceof Error && error.message === 'file-unavailable'
          ? 'helper-missing'
          : 'artifact-untrusted'
      return unavailable(reason, detected, cwd, commonFields)
    }

    let result
    try {
      result = await run(
        $,
        [
          locator.helperPath,
          'preflight',
          '--locator',
          locatorPath,
          '--session',
          sessionId,
          '--expected-sha',
          EXPECTED_HELPER_SHA256,
          '--protocol',
          String(HELPER_PROTOCOL),
        ],
        10_000,
      )
    } catch {
      return unavailable('execution-refused', detected, cwd, commonFields)
    }
    if (result.exitCode !== 0) {
      const reason = safeCategory(result.stderr, 'execution-refused')
      if (
        reason === 'operating-system' ||
        reason === 'operating-system-unproven' ||
        reason === 'architecture' ||
        reason === 'macos-major-version' ||
        reason === 'macos-version-unproven' ||
        reason === 'claude-code-version'
      ) {
        return unsupported(reason, detected, cwd, commonFields)
      }
      return unavailable(reason, detected, cwd, commonFields)
    }

    try {
      const preflight = parseHelperPreflight(result.stdout)
      if (
        preflight.sessionId !== sessionId ||
        preflight.runId !== locator.runId ||
        preflight.archiveGeneration !== locator.archiveGeneration ||
        preflight.databaseRoot !== locator.databaseRoot ||
        preflight.helperPath !== locator.helperPath ||
        preflight.helperProtocol !== HELPER_PROTOCOL ||
        !preflight.macosVersion.startsWith('15.') ||
        preflight.sqliteVersionNumber < 3_035_000
      ) throw new Error('preflight-response')
    } catch {
      return unavailable('preflight-response', detected, cwd, commonFields)
    }

    return {
      support: 'supported',
      reason: 'preflight-ok',
      detected,
      projectPath: cwd,
      ...commonFields,
      helperTrusted: true,
    }
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

function consentKey(projectId: string): string {
  return `prompt-trail:consent:${projectId}`
}

function branchKey(projectId: string, runId: string, sessionId: string): string {
  return `prompt-trail:branch:${projectId}:${runId}:${sessionId}`
}

/* Whether compaction has cleared rows from a classic session's transcript. It
   belongs to the session, not to a Run or a branch, and stays set for good. */
function compactedKey(projectId: string, sessionId: string): string {
  return `prompt-trail:compacted:${projectId}:${sessionId}`
}

function archiveStateKey(projectId: string): string {
  return `prompt-trail:archive-state:${projectId}`
}

function reconcileKey(projectId: string): string {
  return `prompt-trail:reconcile:${projectId}`
}

/* Keyed by Run, not by project. The record is a read-modify-write of a whole
   value, and `$.store` offers no compare-and-swap, so a project-level key lets
   two concurrent Runs derive their queues from the same snapshot and have the
   later write erase the earlier one's Clear Boundary. Each Run owning its own
   record removes the race outright; what a Run still owes on behalf of another
   is found by enumerating the prefix. */
function lifecyclePrefix(projectId: string): string {
  return `prompt-trail:lifecycle:${projectId}:`
}

function lifecycleKey(projectId: string, runId: string): string {
  return `${lifecyclePrefix(projectId)}${runId}`
}

/* Keyed by Run rather than by classic session, so a module reload inside the
   same Run keeps the switch while a new process starts from the default. */
function runModeKey(projectId: string, runId: string): string {
  return `prompt-trail:run-mode:${projectId}:${runId}`
}

/* The band's state, kept per Run: a reload of the Run draws the band the way
   the person left it, and a new process starts collapsed. Issue 21's selection
   position belongs in the same record. */
function uiKey(runId: string): string {
  return `prompt-trail:ui:${runId}`
}

/* The identifier policy for everything read back out of `$.store`, in one
   place: every decoder below applies the same rule to every id it will later
   hand to the helper as argv. */
function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_IDENTIFIER.test(value)
}

/* A generation as the helper names it: an identifier, or `null` when there
   is no archive. Anything else fails the response as `category`. */
function nullableGeneration(value: unknown, category: string): string | null {
  if (value !== null && !isSafeId(value)) throw new Error(category)
  return value
}

function storedConsent(value: unknown): ConsentDecision | undefined {
  if (!isRecord(value) || value.policyVersion !== COLLECTION_POLICY_VERSION) {
    return undefined
  }
  return value.decision === 'enabled' || value.decision === 'declined'
    ? value.decision
    : undefined
}

function storedBranch(value: unknown): BranchState | undefined {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !isSafeId(value.branchId) ||
    (value.parentEventId !== null && !isSafeId(value.parentEventId))
  ) return undefined
  return {
    version: 1,
    branchId: value.branchId,
    parentEventId: value.parentEventId,
    ...(value.explicitRoot === true ? { explicitRoot: true as const } : {}),
    ...(value.rootReason === 'ambiguous-prefix' ? { rootReason: 'ambiguous-prefix' as const } : {}),
    ...(isSafeId(value.generation) ? { generation: value.generation } : {}),
  }
}

function storedRunMode(value: unknown): RunModeState | undefined {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    (value.mode !== 'enabled' && value.mode !== 'disabled')
  ) return undefined
  const missing = value.stopBoundaryMissing === true
    ? { stopBoundaryMissing: true as const }
    : {}
  const boundary = value.boundary
  if (boundary === undefined) return { version: 1, mode: value.mode, ...missing }
  if (
    !isRecord(boundary) ||
    !isCollectionBoundaryKind(boundary.kind) ||
    !isSafeId(boundary.eventId) ||
    !Number.isSafeInteger(boundary.sequence) ||
    (boundary.sequence as number) < 1
  ) return { version: 1, mode: value.mode, ...missing }
  return {
    version: 1,
    mode: value.mode,
    boundary: {
      kind: boundary.kind,
      eventId: boundary.eventId,
      sequence: boundary.sequence as number,
    },
    ...missing,
  }
}

function storedReconcile(value: unknown): ReconcileState | undefined {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !isSafeId(value.eventId) ||
    !isSafeId(value.runId) ||
    !isSafeId(value.branchId)
  ) return undefined
  const parent = value.parentEventId
  if (parent !== null && !isSafeId(parent)) return undefined
  const attachmentCount = Number.isSafeInteger(value.attachmentCount)
    && (value.attachmentCount as number) >= 0
    ? value.attachmentCount as number
    : 0
  return {
    version: 1,
    eventId: value.eventId,
    runId: value.runId,
    branchId: value.branchId,
    parentEventId: parent,
    attachmentCount,
    ...(isSafeId(value.generation) ? { generation: value.generation } : {}),
  }
}

/* A queued lifecycle write is replayed verbatim into `boundary-append`, where
   a single changed field fails the whole retry as `boundary-conflict`. So the
   record is accepted only when every field it will replay is intact; a damaged
   one is dropped rather than retried into a permanent refusal. */
/* A queued write that names no generation was queued by a build from before
   writes named one: which generation it belongs to cannot be recovered. */
const UNKNOWN_GENERATION = 'unknown'

function storedLifecycleWrite(value: unknown, queued: boolean): LifecycleWrite | undefined {
  if (!isRecord(value)) return undefined
  /* An end a build from before Runs were lineages still owes: it is the same
     fact, a process leaving the Run, and is replayed under its original id. */
  const kind = value.kind === 'run-ended' ? 'run-detached' : value.kind
  if (
    (kind !== 'clear'
      && kind !== 'run-started'
      && kind !== 'run-attached'
      && kind !== 'run-detached') ||
    !isSafeId(value.eventId) ||
    !isSafeId(value.runId) ||
    !isSafeId(value.segmentId) ||
    !isSafeId(value.branchId) ||
    !Number.isSafeInteger(value.occurredAt) ||
    (value.occurredAt as number) < 0
  ) return undefined
  return {
    kind,
    eventId: value.eventId,
    runId: value.runId,
    segmentId: value.segmentId,
    branchId: value.branchId,
    occurredAt: value.occurredAt as number,
    ...(value.generation === null || isSafeId(value.generation)
      ? { generation: value.generation }
      : queued ? { generation: UNKNOWN_GENERATION } : {}),
  }
}

function storedClearTransition(value: unknown): LifecycleState['clear'] {
  if (
    !isRecord(value) ||
    !isSafeId(value.eventId) ||
    !isSafeId(value.endedSessionId) ||
    !isSafeId(value.runId)
  ) return undefined
  const resumed = value.resumedSessionId
  return {
    eventId: value.eventId,
    endedSessionId: value.endedSessionId,
    runId: value.runId,
    ...(isSafeId(resumed) ? { resumedSessionId: resumed } : {}),
    ...(value.priorUnfinished === true ? { priorUnfinished: true as const } : {}),
  }
}

/* A damaged attachment is dropped: the next process opens a new one, and the
   old one reads as a stretch whose leaving was never recorded, which is true. */
function storedAttachment(value: unknown): Attachment | undefined {
  if (
    !isRecord(value) ||
    !isSafeId(value.id) ||
    typeof value.host !== 'string' ||
    !/^\d+-\d+-\d+$/.test(value.host) ||
    !isSafeId(value.segmentId)
  ) return undefined
  const leaving = value.leaving === undefined ? undefined : storedLifecycleWrite(value.leaving, true)
  return {
    id: value.id,
    host: value.host,
    segmentId: value.segmentId,
    ...(value.closed === true ? { closed: true as const } : {}),
    ...(leaving?.kind === 'run-detached' ? { leaving } : {}),
  }
}

const GAP_REASON_SET = new Set<string>(GAP_REASONS)

/* An owed gap is replayed only when every field it names is intact; one that
   is not is still a loss, and is owed again from what can be read. */
function storedGap(value: unknown): OwedGap | undefined {
  if (
    !isRecord(value) ||
    !isSafeId(value.eventId) ||
    !isSafeId(value.runId) ||
    !isSafeId(value.segmentId) ||
    !isSafeId(value.branchId) ||
    !Number.isSafeInteger(value.occurredAt) ||
    (value.occurredAt as number) < 0 ||
    !(value.generation === null || isSafeId(value.generation)) ||
    !Array.isArray(value.reasons) ||
    !value.reasons.every(reason => typeof reason === 'string' && GAP_REASON_SET.has(reason))
  ) return undefined
  const landed = value.landed === true
    && Number.isSafeInteger(value.recoveryAt)
    && (value.recoveryAt as number) >= 0
  return {
    eventId: value.eventId,
    runId: value.runId,
    segmentId: value.segmentId,
    branchId: value.branchId,
    occurredAt: value.occurredAt as number,
    generation: value.generation as string | null,
    reasons: value.reasons as GapReason[],
    ...(landed ? { landed: true as const, recoveryAt: value.recoveryAt as number } : {}),
  }
}

function storedLifecycle(value: unknown): LifecycleState | undefined {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.queue)) {
    return undefined
  }
  const queue: LifecycleWrite[] = []
  let damaged = value.damaged === true
  for (const row of value.queue.slice(0, LIFECYCLE_QUEUE_CAPACITY)) {
    const write = storedLifecycleWrite(row, true)
    if (write) queue.push(write)
    /* Replaying a row whose fields no longer hold would fail as a
       `boundary-conflict` forever, so it is dropped — and the loss recorded,
       because a lifecycle fact that cannot be written is a gap, not a no-op. */
    else damaged = true
  }
  if (value.queue.length > LIFECYCLE_QUEUE_CAPACITY) damaged = true
  const clear = storedClearTransition(value.clear)
  const attachment = storedAttachment(value.attachment)
  const gap = storedGap(value.gap)
  if (value.gap !== undefined && !gap) damaged = true
  return {
    version: 1,
    queue,
    ...(clear ? { clear } : {}),
    ...(value.unobservedClear === true ? { unobservedClear: true as const } : {}),
    ...(value.overflowed === true ? { overflowed: true as const } : {}),
    ...(damaged ? { damaged: true as const } : {}),
    ...(value.started === true ? { started: true as const } : {}),
    ...(attachment ? { attachment } : {}),
    ...(gap ? { gap } : {}),
  }
}

function isCollectionBoundaryKind(value: unknown): value is CollectionBoundaryKind {
  return value === 'collection-started'
    || value === 'collection-stopped'
    || value === 'collection-resumed'
}

/* A Run with no stored record collects by default; `stored` tells enable
   whether this Run is resuming after its own explicit disable. */
async function loadRunMode(
  $: EngineInterface,
  currentProject: ProjectState,
): Promise<{ key: string; value: RunModeState }> {
  if (!startup.runId) {
    /* Without a proven Run id the switch still has to be readable, or an
       unhealthy target would silently resume collecting a disabled Run. */
    if (runMode?.key.startsWith(`prompt-trail:run-mode:${currentProject.id}:`)) {
      return { key: runMode.key, value: runMode.value }
    }
    throw new Error('capture-identity')
  }
  const key = runModeKey(currentProject.id, startup.runId)
  if (runMode?.key === key) return { key, value: runMode.value }
  /* An unreadable switch is not an absent one: defaulting to enabled here
     would resume collecting a Run the person explicitly disabled, so the
     failure propagates and the caller fails closed. */
  const value = storedRunMode(await $.store.get(key))
    ?? { version: 1, mode: 'enabled' as const }
  runMode = { key, value }
  return { key, value }
}

async function saveRunMode(
  $: EngineInterface,
  key: string,
  value: RunModeState,
): Promise<void> {
  runMode = { key, value }
  await $.store.set(key, value)
}

/* An unreadable lifecycle record is not an empty one: it may be hiding a Clear
   Boundary the archive still owes, so the failure propagates and the caller
   fails closed exactly as an unreadable Pending Capture does.

   It is re-read rather than cached. The record is keyed by project, so a
   concurrent Run may have queued a Clear Boundary this one has never seen, and
   writing back a stale copy would drop it. */
async function loadLifecycle(
  $: EngineInterface,
  currentProject: ProjectState,
): Promise<LifecycleState> {
  if (!startup.runId) throw new Error('capture-identity')
  const key = lifecycleKey(currentProject.id, startup.runId)
  let value: LifecycleState
  try {
    const stored = await $.store.get(key)
    /* A record that is there and cannot be read lost whatever it owed: that
       is a loss to record, not an empty queue. */
    value = storedLifecycle(stored)
      ?? (stored === undefined ? emptyLifecycle() : { ...emptyLifecycle(), damaged: true })
  } catch (error) {
    /* Not knowing is reported as not knowing, never as an empty queue. */
    lifecycle = undefined
    throw error
  }
  lifecycle = { key, value }
  return value
}

async function saveLifecycle(
  $: EngineInterface,
  currentProject: ProjectState,
  value: LifecycleState,
): Promise<void> {
  if (!startup.runId) throw new Error('capture-identity')
  const key = lifecycleKey(currentProject.id, startup.runId)
  value = await stampGenerations($, currentProject, value)
  lifecycle = { key, value }
  await $.store.set(key, value)
}

/* A fact is owed to the generation in place as it happens, so a clear or a
   quarantine before it lands retires it with the rest of that history. One
   stamped while the archive cannot say is unknown, and is never replayed
   into whichever generation stands by then. */
async function stampGenerations(
  $: EngineInterface,
  currentProject: ProjectState,
  value: LifecycleState,
): Promise<LifecycleState> {
  const leaving = value.attachment?.leaving
  const unstamped = leaving !== undefined && leaving.generation === undefined
  if (!unstamped && !value.queue.some(write => write.generation === undefined)) return value
  let generation: string | null = UNKNOWN_GENERATION
  try {
    generation = (await readArchiveStatus($, currentProject)).generation
  } catch {
    // Left unknown.
  }
  return {
    ...value,
    queue: value.queue.map(write =>
      write.generation === undefined ? { ...write, generation } : write),
    /* A detach held at an in-process `/resume` happened then, not when it is
       later queued. */
    ...(unstamped && value.attachment && leaving
      ? { attachment: { ...value.attachment, leaving: { ...leaving, generation } } }
      : {}),
  }
}

/* What the project's other Runs left behind. A Run that crashed mid-`/clear`
   cannot come back to finish it, so whoever archives next in this project owes
   its boundary — and, for the report, its interrupted transition. */
async function foreignLifecycles(
  $: EngineInterface,
  currentProject: ProjectState,
): Promise<{ key: string; value: LifecycleState }[]> {
  const prefix = lifecyclePrefix(currentProject.id)
  const own = startup.runId ? lifecycleKey(currentProject.id, startup.runId) : undefined
  const found: { key: string; value: LifecycleState }[] = []
  for (const key of await $.store.keys()) {
    if (!key.startsWith(prefix) || key === own) continue
    /* A record that cannot be read lost what it owed, as this Run's own does. */
    const value = storedLifecycle(await $.store.get(key)) ?? { ...emptyLifecycle(), damaged: true as const }
    found.push({ key, value })
  }
  lifecycleOthers = {
    queue: found.flatMap(record => record.value.queue),
    /* Another Run's transition can never complete: only the Run that cut the
       segment may claim it, and that Run is gone. */
    unfinished: found.filter(record => record.value.clear !== undefined
      && record.value.clear.resumedSessionId === undefined).length,
  }
  return found
}

function parseBoundaryResponse(
  text: string,
  eventId: string,
  projectId: string,
  kind: BoundaryKind,
): number {
  const value: unknown = JSON.parse(text)
  if (
    !isRecord(value) ||
    value.eventId !== eventId ||
    value.projectId !== projectId ||
    value.kind !== kind ||
    !Number.isSafeInteger(value.sequence) ||
    (value.sequence as number) < 1
  ) throw new Error('boundary-response')
  return value.sequence as number
}

/* A boundary is a non-prompt Timeline Event: it carries no text and takes the
   next project-level sequence, so it orders against Prompt Entries.

   The overrides exist for the Clear Boundary, which is not free to invent its
   own identity: its event id is derived from the classic session that ended, it
   belongs to that ending segment rather than to whichever session is current
   by the time it is written, and a retry must replay the original instant or
   the helper refuses it as a conflict. */
async function appendBoundary(
  $: EngineInterface,
  currentProject: ProjectState,
  branchId: string,
  kind: BoundaryKind,
  overrides: {
    eventId?: string
    segmentId?: string
    occurredAt?: number
    runId?: string
    generation?: string | null
  } = {},
): Promise<{ eventId: string; sequence: number }> {
  const segmentId = overrides.segmentId ?? startup.sessionId
  /* A replay must name the Run that owns the boundary, not the Run replaying
     it: the helper compares `run_id` on a repeated event id and refuses a
     changed one as `boundary-conflict`, so a queue drained by a later process
     would either be misattributed or blocked for good. */
  const runId = overrides.runId ?? startup.runId
  if (!startup.helperPath || !startup.databaseRoot || !runId || !segmentId) {
    throw new Error('capture-identity')
  }
  const eventId = overrides.eventId ?? crypto.randomUUID()
  const result = await runArchive(
    $,
    [
      startup.helperPath,
      'boundary-append',
      startup.databaseRoot,
      currentProject.id,
      runId,
      segmentId,
      branchId,
      kind,
      eventId,
      String(overrides.occurredAt ?? await $.clock.now()),
      overrides.generation ?? '-',
      EXPECTED_HELPER_SHA256,
      String(HELPER_PROTOCOL),
    ],
    10_000,
  )
  /* The helper's own category rather than one flat label: a lifecycle write
     that fails leaves nothing behind but this, and a boundary the archive
     never took is exactly the kind of failure that has to stay identifiable. */
  if (result.exitCode !== 0) {
    throw new Error(safeCategory(result.stderr, 'boundary-append'))
  }
  const sequence = parseBoundaryResponse(
    result.stdout,
    eventId,
    currentProject.id,
    kind,
  )
  currentProject.archiveReady = true
  await archiveRecovered($, currentProject)
  return { eventId, sequence }
}

async function canonicalProjectRoot(
  $: EngineInterface,
  cwd: string,
): Promise<string> {
  const canonicalCwd = await realpath($, cwd)
  const git = await run($, gitToplevelArgv(canonicalCwd))
  let insideGitRepository = false
  if (git.exitCode !== 0) {
    for (let directory = canonicalCwd; ;) {
      if (await $.fs.exists(`${directory}/.git`)) {
        insideGitRepository = true
        break
      }
      const slash = directory.lastIndexOf('/')
      if (slash <= 0) break
      directory = directory.slice(0, slash)
    }
  }
  const candidate = projectRootFrom(canonicalCwd, git, insideGitRepository)
  if (candidate === undefined) throw new Error('project-root-unproven')
  const canonical = await realpath($, candidate)
  if (!canonical.startsWith('/') || /[\u0000-\u001f\u007f]/.test(canonical)) {
    throw new Error('project-root-unproven')
  }
  return canonical
}

async function prepareProject($: EngineInterface): Promise<ProjectState> {
  if (!runtimeTarget) throw new Error('project-root-unproven')
  const root = await canonicalProjectRoot($, runtimeTarget.cwd)
  const id = await sha256(root)
  const databasePath = startup.databaseRoot
    ? `${startup.databaseRoot}/${id}.sqlite3`
    : undefined
  if (project?.id === id) {
    project.root = root
    if (databasePath) project.databasePath = databasePath
    startup.projectPath = root
    /* Consent belongs to the Project Timeline, which concurrent Runs share:
       another Run may have been asked since this one last looked. */
    project.consent = storedConsent(await $.store.get(consentKey(id))) ?? project.consent
    /* So is the archive, and another Run may have found it failing, or
       working again, since this one last looked. */
    await readArchiveState($, project)
    return project
  }
  const consent = storedConsent(await $.store.get(consentKey(id)))
  archiveFailure = undefined
  let owed: ReconcileState | undefined
  let owedUnknown = false
  try {
    owed = storedReconcile(await $.store.get(reconcileKey(id)))
  } catch {
    owedUnknown = true
  }
  reconcile = owed ? { state: owed } : undefined
  pendingDiscovered = false
  pendingUnknown = undefined
  pendingElsewhere = undefined
  runMode = undefined
  /* The lifecycle record is keyed by Run, so it is read once the Run is proven
     rather than here. Left unset, status reports it as unknown rather than as
     an empty queue. */
  lifecycle = undefined
  /* A `/clear` held for the project left behind is not recorded now: its
     marker stays, no longer held, to say so. */
  if (deferredClear?.marker) liveCalls.delete(markerCall(deferredClear.marker))
  deferredClear = undefined
  /* The band shows one Project Timeline: another project's rows, read back or
     recorded here, are not this one's to draw. */
  resetWindow()
  timelineLoaded = undefined
  project = {
    root,
    id,
    databasePath,
    consent,
    archiveReady: false,
  }
  startup.projectPath = root
  await readArchiveState($, project)
  /* Not knowing whether something is owed is itself a reason to stop, so an
     unreadable record fails closed exactly as an unreadable archive does. */
  if (owedUnknown && consent === 'enabled') {
    archiveFailure = runLocal('store-unavailable', true)
  }
  return project
}

/* The project's shared record of a failing archive: every submission, `enable`
   and `status` reads it again, so a Run stops at its next operation after
   another Run found the archive failing, and resumes once any Run proved it
   works. A record that cannot be read stops this Run as a failing archive
   would, without being written anywhere. */
async function readArchiveState($: EngineInterface, currentProject: ProjectState): Promise<void> {
  const before = JSON.stringify(archiveFailure)
  await readArchiveRecord($, currentProject)
  forgetOtherRunsFailure()
  /* The band says what this Run knows, which a read can change either way. */
  if (JSON.stringify(archiveFailure) !== before) $.ui.invalidate('ui.render')
}

async function readArchiveRecord($: EngineInterface, currentProject: ProjectState): Promise<void> {
  let stored: unknown
  try {
    stored = await $.store.get(archiveStateKey(currentProject.id))
  } catch {
    if (currentProject.consent === 'enabled') archiveFailure = runLocal('store-unavailable', true)
    return
  }
  if (
    isRecord(stored)
    && (stored.version === 1 || stored.version === 2)
    && stored.state === 'unavailable'
  ) {
    /* The first builds recorded neither the category nor the Run. */
    const category = typeof stored.category === 'string' && isFailureCategory(stored.category)
      ? stored.category
      : 'category-unrecorded'
    const elsewhere = typeof stored.runId === 'string' && stored.runId !== startup.runId
    const recheck = storedRecheck(stored.recheck)
    archiveFailure = {
      scope: 'archive',
      category,
      elsewhere,
      blocking: true,
      ...(isSafeId(stored.generation) ? { generation: stored.generation } : {}),
      ...(recheck ? { recheck } : {}),
    }
    return
  }
  if (archiveFailure?.scope === 'archive') archiveFailure = undefined
}

function runLocal(category: string, blocking: boolean): Unavailable {
  return {
    scope: 'run',
    category,
    elsewhere: false,
    blocking,
    ...(startup.runId ? { runId: startup.runId } : {}),
  }
}

/* After an in-process `/resume` into another Run, the Run left behind keeps
   its own failure; the archive's stays for every Run. */
function forgetOtherRunsFailure(): void {
  if (startup.runId && archiveFailure?.scope === 'run' && archiveFailure.runId !== startup.runId) {
    archiveFailure = undefined
  }
}

function isFailureCategory(category: string): boolean {
  return SAFE_ERROR_CATEGORIES.has(category) || PLUGIN_FAILURES.has(category)
}

/* The category a failure is shown and recorded under: a helper's own, or the
   plugin's name for what it met, never the text an error carries. */
function failureCategory(error: unknown, fallback: string): string {
  return error instanceof Error && isFailureCategory(error.message) ? error.message : fallback
}

/* A failure of the archive itself goes on record for the project's other
   Runs; a Run-local one stays with this Run, which tries again for real at
   its next submission. */
async function markUnavailable(
  $: EngineInterface,
  currentProject: ProjectState | undefined,
  category: string,
  scope: 'run' | 'archive' = SHARED_FAILURES.has(category) ? 'archive' : 'run',
): Promise<Unavailable> {
  /* Damage met again keeps the generation already on record when this
     failure could not name one; a quarantine that failed keeps the
     generation it was moving, and a recheck's findings stay with the damage
     they describe. */
  const damage = DAMAGE_FAILURES.has(category)
  const generation = category === 'archive-integrity'
    ? damagedGeneration ?? archiveFailure?.generation
    : damage ? archiveFailure?.generation : undefined
  const recheck = damage ? archiveFailure?.recheck : undefined
  archiveFailure = scope === 'archive'
    ? {
        scope,
        category,
        elsewhere: false,
        blocking: true,
        ...(generation ? { generation } : {}),
        ...(recheck ? { recheck } : {}),
      }
    : runLocal(category, false)
  $.ui.invalidate('ui.render')
  if (scope === 'archive' && currentProject) {
    try {
      await $.store.set(archiveStateKey(currentProject.id), {
        version: 2,
        state: 'unavailable',
        category,
        since: await $.clock.now(),
        ...(startup.runId ? { runId: startup.runId } : {}),
        ...(generation ? { generation } : {}),
        ...(recheck ? { recheck } : {}),
      })
    } catch {
      // The in-memory block remains active for this module instance.
    }
  }
  return archiveFailure
}

/* A write the archive took proves it works, for this Run and every other:
   whichever Run lands one first lifts the record. */
async function archiveRecovered(
  $: EngineInterface,
  currentProject: ProjectState,
): Promise<void> {
  if (archiveFailure) {
    archiveFailure = undefined
    $.ui.invalidate('ui.render')
  }
  try {
    await $.store.delete(archiveStateKey(currentProject.id))
  } catch {
    // Left on record, the next Run to read it retries before it collects.
  }
}

async function requestConsent(
  $: EngineInterface,
  currentProject: ProjectState,
): Promise<ConsentDecision | undefined> {
  if (currentProject.consent) return currentProject.consent
  if (!currentProject.databasePath) throw new Error('database-root-unavailable')
  /* Another Run of the project may have answered meanwhile, even while this
     dialog was up: the first answer is the project's, never asked again or
     overwritten here. */
  const answered = async () => {
    const stored = storedConsent(await $.store.get(consentKey(currentProject.id)))
    if (stored) currentProject.consent = stored
    return stored
  }
  const earlier = await answered()
  if (earlier) return earlier
  const answer = await $.ui.ask(
    [
      'Prompt Trail 会保存每次成功提交的完整最终文本。',
      '内容以明文保存在本机，永久保留且没有应用配额，可能包含凭据。',
      `数据库：${currentProject.databasePath}`,
      '同一系统账户或 root 可读取或篡改这些数据。',
      'Prompt Trail 的删除不会删除 Claude Code transcript、文件系统快照或外部备份中的副本。',
      '是否为这个 Project Timeline 启用采集？',
    ].join('\n'),
    {
      header: '采集同意',
      options: ['启用', '继续但不启用'],
    },
  )
  const decision = answer === '启用'
    ? 'enabled'
    : answer === '继续但不启用'
      ? 'declined'
      : undefined
  if (!decision) return undefined
  const settled = (kept: ConsentDecision): ConsentDecision => {
    if (kept !== decision) {
      $.ui.toast(`另一个 Run 已先为本项目${kept === 'enabled' ? '启用采集' : '选择不启用采集'}，这里的选择未生效。`)
    }
    return kept
  }
  const first = await answered()
  if (first) return settled(first)
  currentProject.consent = decision
  try {
    await $.store.set(consentKey(currentProject.id), {
      policyVersion: COLLECTION_POLICY_VERSION,
      decision,
    })
  } catch (error) {
    if (decision === 'enabled') {
      currentProject.consent = undefined
      throw error
    }
  }
  /* The store has no set-if-absent: two Runs saving at once both find no
     answer, and the later write is the one kept. Reading it back makes both
     agree on it. */
  let kept: ConsentDecision = decision
  try {
    kept = (await answered()) ?? decision
  } catch {
    // What this Run saved stands until the next look at the store.
  }
  /* The archive has just become this plugin's to look into, and it may already
     hold what an earlier consent recorded. */
  if (settled(kept) === 'enabled') {
    try {
      await loadTimeline($, currentProject)
    } catch {
      // The band shows what this module instance records from here on.
    }
  }
  return kept
}

/* The Active Branch is keyed by classic session, which is what makes a
   Conversation Segment its own lineage: the session id changes across a
   `/clear`, so the next segment asks for a branch that does not exist yet and
   is given a fresh root. Nothing has to cut the parent chain by hand.

   `forSessionId` names a segment other than the current one, which the
   lifecycle hooks need: at `classic.SessionEnd` the boundary belongs to the
   session that is ending. */
async function branchState(
  $: EngineInterface,
  currentProject: ProjectState,
  forSessionId?: string,
): Promise<{ key: string; value: BranchState }> {
  const sessionId = forSessionId ?? startup.sessionId
  if (!startup.runId || !sessionId) {
    throw new Error('capture-identity')
  }
  const key = branchKey(currentProject.id, startup.runId, sessionId)
  const existing = storedBranch(await $.store.get(key))
  if (existing) return { key, value: existing }
  /* A session the conversation was moved to takes up the branch the session
     it came from was on, until it has one of its own. */
  const continued = sessionId === startup.sessionId && startup.continuedFrom
    ? storedBranch(
      await $.store.get(branchKey(currentProject.id, startup.runId, startup.continuedFrom)),
    )
    : undefined
  const value: BranchState = continued ?? {
    version: 1,
    branchId: crypto.randomUUID(),
    parentEventId: null,
  }
  await $.store.set(key, value)
  return { key, value }
}

/* The generation the capture was staged in, and whether the archive's disk
   is low on space, when the helper could ask it. */
type Staged = { generation: string; lowSpace: boolean | undefined }

function parsePendingResponse(
  text: string,
  eventId: string,
  projectId: string,
): Staged {
  const value: unknown = JSON.parse(text)
  if (
    !isRecord(value) ||
    value.eventId !== eventId ||
    value.projectId !== projectId ||
    value.pending !== true ||
    !isSafeId(value.generation) ||
    (value.lowSpace !== undefined && typeof value.lowSpace !== 'boolean')
  ) throw new Error('capture-response')
  return { generation: value.generation, lowSpace: value.lowSpace as boolean | undefined }
}

type Confirmed = { sequence: number; ordinal: number }

function parseConfirmedResponse(
  text: string,
  eventId: string,
  projectId: string,
): Confirmed {
  const value: unknown = JSON.parse(text)
  if (
    !isRecord(value) ||
    value.eventId !== eventId ||
    value.projectId !== projectId ||
    !Number.isSafeInteger(value.sequence) ||
    (value.sequence as number) < 1 ||
    !Number.isSafeInteger(value.ordinal) ||
    (value.ordinal as number) < 1
  ) throw new Error('capture-response')
  return { sequence: value.sequence as number, ordinal: value.ordinal as number }
}

async function beginCapture(
  $: EngineInterface,
  currentProject: ProjectState,
  branch: BranchState,
  eventId: string,
  occurredAt: number,
  text: string,
  attachmentKinds: readonly string[],
): Promise<Staged> {
  if (!startup.helperPath || !startup.databaseRoot || !startup.runId || !startup.sessionId) {
    throw new Error('capture-identity')
  }
  const result = await runArchive(
    $,
    [
      startup.helperPath,
      'capture-begin',
      startup.databaseRoot,
      currentProject.id,
      startup.runId,
      startup.sessionId,
      branch.branchId,
      branch.parentEventId ?? '-',
      eventId,
      String(occurredAt),
      String(attachmentKinds.length),
      attachmentKinds.length > 0 ? attachmentKinds.join(',') : '-',
      branch.generation ?? '-',
      EXPECTED_HELPER_SHA256,
      String(HELPER_PROTOCOL),
      '--stdin',
    ],
    10_000,
    text,
  )
  if (result.exitCode !== 0) throw new Error(safeCategory(result.stderr, 'capture-begin'))
  const staged = parsePendingResponse(result.stdout, eventId, currentProject.id)
  currentProject.archiveReady = true
  await archiveRecovered($, currentProject)
  return staged
}

/* `text` is the text `next(e)` returned. Without it — a reconciliation after a
   restart, where the draft is gone — the helper archives the bytes it already
   staged, which never leave it. */
async function confirmCapture(
  $: EngineInterface,
  currentProject: ProjectState,
  eventId: string,
  text: string | undefined,
): Promise<Confirmed> {
  if (!startup.helperPath || !startup.databaseRoot) {
    throw new Error('capture-identity')
  }
  const result = await runArchive(
    $,
    [
      startup.helperPath,
      'capture-confirm',
      startup.databaseRoot,
      currentProject.id,
      eventId,
      EXPECTED_HELPER_SHA256,
      String(HELPER_PROTOCOL),
      text === undefined ? '--pending' : '--stdin',
    ],
    10_000,
    text,
  )
  if (result.exitCode !== 0) throw new Error(safeCategory(result.stderr, 'capture-confirm'))
  const confirmed = parseConfirmedResponse(result.stdout, eventId, currentProject.id)
  await archiveRecovered($, currentProject)
  return confirmed
}

function parsePendingList(
  text: string,
  projectId: string,
): { owed: ReconcileState[]; skipped: number } {
  const value: unknown = JSON.parse(text)
  if (
    !isRecord(value) ||
    value.projectId !== projectId ||
    !Array.isArray(value.pending) ||
    !Number.isSafeInteger(value.skipped) ||
    (value.skipped as number) < 0
  ) throw new Error('capture-list')
  const generation = nullableGeneration(value.generation, 'capture-list')
  const owed: ReconcileState[] = []
  for (const row of value.pending) {
    const state = storedReconcile(isRecord(row) ? { ...row, version: 1, generation } : undefined)
    if (!state) throw new Error('capture-list')
    owed.push(state)
  }
  return { owed, skipped: value.skipped as number }
}

/* What the archive still holds unresolved. It is the only way a new process
   learns that a previous one left a Pending Capture behind — its `$.store`
   record may never have been written. A pending of another Run that a live
   process is attached to may still be in flight there: the helper leaves it
   out and only counts it. */
async function listPending(
  $: EngineInterface,
  currentProject: ProjectState,
): Promise<{ owed: ReconcileState[]; skipped: number }> {
  if (!startup.helperPath || !startup.databaseRoot || !startup.runId) {
    throw new Error('capture-identity')
  }
  const result = await runArchive(
    $,
    [
      startup.helperPath,
      'capture-list',
      startup.databaseRoot,
      currentProject.id,
      startup.runId,
      EXPECTED_HELPER_SHA256,
      String(HELPER_PROTOCOL),
    ],
    10_000,
  )
  if (result.exitCode !== 0) throw new Error(safeCategory(result.stderr, 'capture-list'))
  return parsePendingList(result.stdout, currentProject.id)
}

const TIMELINE_KINDS = new Set<string>([
  'collection-started',
  'collection-stopped',
  'collection-resumed',
  'clear',
  'run-started',
  'run-attached',
  'run-detached',
  'archive-quarantined',
  'integrity-gap',
  'integrity-recovery',
])

/* What an archive written before a Run became a conversation's lineage called
   a process leaving it. */
const LEGACY_KINDS = new Map<string, BoundaryKind>([['run-ended', 'run-detached']])

/* A response that is not exactly the shape the helper writes is refused
   whole: a row that cannot be trusted is not drawn as history. */
function parseTimeline(value: unknown, projectId: string): TimelineItem[] {
  if (
    !isRecord(value) ||
    value.projectId !== projectId ||
    !Array.isArray(value.events) ||
    typeof value.earlier !== 'boolean' ||
    typeof value.later !== 'boolean'
  ) throw new Error('timeline-read')
  return value.events.map((row: unknown): TimelineItem => {
    if (
      !isRecord(row) ||
      !isSafeId(row.eventId) ||
      !isSafeId(row.runId) ||
      !Number.isSafeInteger(row.sequence) ||
      (row.sequence as number) < 1
    ) throw new Error('timeline-read')
    if (row.segmentId !== undefined && !isSafeId(row.segmentId)) {
      throw new Error('timeline-read')
    }
    if (row.branchId !== undefined && !isSafeId(row.branchId)) {
      throw new Error('timeline-read')
    }
    const identity = {
      eventId: row.eventId,
      sequence: row.sequence as number,
      runId: row.runId,
      ...(row.segmentId === undefined ? {} : { segmentId: row.segmentId }),
    }
    if (row.kind === 'prompt') {
      if (
        typeof row.text !== 'string' ||
        !Number.isSafeInteger(row.attachmentCount) ||
        (row.attachmentCount as number) < 0 ||
        !Number.isSafeInteger(row.ordinal) ||
        (row.ordinal as number) < 1
      ) throw new Error('timeline-read')
      const parent = row.parentEventId
      if (parent !== undefined && parent !== null && !isSafeId(parent)) {
        throw new Error('timeline-read')
      }
      return {
        kind: 'prompt',
        ...identity,
        ...(row.branchId === undefined ? {} : { branchId: row.branchId }),
        ...(parent === undefined ? {} : { parentEventId: parent }),
        text: row.text,
        attachmentCount: row.attachmentCount as number,
        ordinal: row.ordinal as number,
      }
    }
    const kind = typeof row.kind === 'string' ? LEGACY_KINDS.get(row.kind) ?? row.kind : undefined
    if (kind === undefined || !TIMELINE_KINDS.has(kind)) throw new Error('timeline-read')
    return { kind: 'boundary', ...identity, boundary: kind as BoundaryKind }
  })
}

/* One batch the helper holds fixed: 128 events and one more on the side read
   towards. The band keeps two batches and that one row. */
const TIMELINE_BATCH = 128
const WINDOW_LIMIT = 2 * TIMELINE_BATCH + 1

type TimelineBatch = {
  /* The generation the batch was read from; `null` before there is one. */
  generation: string | null
  items: TimelineItem[]
  earlier: boolean
  later: boolean
  path?: { tip: string; eventIds: string[]; start: number | null }
  parents: Map<string, string>
  origins: Map<string, string>
}

function parseContext(value: unknown): Map<string, string> {
  if (!Array.isArray(value)) throw new Error('timeline-read')
  return new Map(value.map((row: unknown) => {
    if (!isRecord(row) || !isSafeId(row.eventId) || !isSafeId(row.runId)) {
      throw new Error('timeline-read')
    }
    return [row.eventId, row.runId] as const
  }))
}

function parseBatch(text: string, projectId: string, tip: string | undefined): TimelineBatch {
  const value: unknown = JSON.parse(text)
  if (!isRecord(value)) throw new Error('timeline-read')
  const batch: TimelineBatch = {
    generation: nullableGeneration(value.generation, 'timeline-read'),
    items: parseTimeline(value, projectId),
    earlier: value.earlier as boolean,
    later: value.later as boolean,
    parents: parseContext(value.parents),
    origins: parseContext(value.origins),
  }
  if (tip !== undefined) {
    const path = value.path
    if (
      !isRecord(path) ||
      !Array.isArray(path.eventIds) ||
      !path.eventIds.every(isSafeId) ||
      !(path.start === null || (Number.isSafeInteger(path.start) && (path.start as number) >= 1))
    ) throw new Error('timeline-read')
    batch.path = { tip, eventIds: path.eventIds, start: path.start as number | null }
  }
  return batch
}

/* Where this session's Active Branch ends, for the helper to place it. */
function currentTip(currentProject: ProjectState): string | undefined {
  if (!startup.runId || !startup.sessionId) return undefined
  const key = branchKey(currentProject.id, startup.runId, startup.sessionId)
  return activeBranch?.key === key ? activeBranch.value.parentEventId ?? undefined : undefined
}

/* One fixed batch: the latest, or the one next to an event the window holds. */
async function readBatch(
  $: EngineInterface,
  currentProject: ProjectState,
  cursor?: readonly ['before' | 'after', number],
): Promise<TimelineBatch> {
  if (!startup.helperPath || !startup.databaseRoot) throw new Error('timeline-read')
  const tip = currentTip(currentProject)
  const result = await runArchive(
    $,
    [
      startup.helperPath,
      'timeline-read',
      startup.databaseRoot,
      currentProject.id,
      EXPECTED_HELPER_SHA256,
      String(HELPER_PROTOCOL),
      ...(cursor ? [cursor[0], String(cursor[1])] : []),
      tip === undefined ? '-' : startup.runId ?? '-',
      tip ?? '-',
    ],
    10_000,
  )
  if (result.exitCode !== 0) throw new Error(safeCategory(result.stderr, 'timeline-read'))
  return parseBatch(result.stdout, currentProject.id, tip)
}

function resetWindow(): void {
  viewGeneration = undefined
  timeline = []
  timelineEdges = { earlier: false, later: false }
  parentRuns = new Map()
  segmentOrigins = new Map()
  activePath = undefined
  unread = 0
}

/* Keeps the window within its limit by dropping from the end away from where
   it grew, and the context to what the window still draws. */
function boundWindow(grew: 'earlier' | 'later'): void {
  if (timeline.length > WINDOW_LIMIT) {
    if (grew === 'earlier') {
      timeline = timeline.slice(0, WINDOW_LIMIT)
      timelineEdges.later = true
    } else {
      timeline = timeline.slice(-WINDOW_LIMIT)
      timelineEdges.earlier = true
    }
  }
  const held = new Set(timeline.map(item => item.eventId))
  const parents = new Set(timeline.flatMap(item =>
    item.kind === 'prompt' && item.parentEventId ? [item.parentEventId] : []))
  parentRuns = new Map([...parentRuns].filter(([eventId]) => parents.has(eventId)))
  segmentOrigins = new Map([...segmentOrigins].filter(([eventId]) => held.has(eventId)))
  if (activePath) {
    activePath.eventIds = new Set([...activePath.eventIds].filter(eventId => held.has(eventId)))
  }
}

function mergeBatch(batch: TimelineBatch, at: 'latest' | 'earlier' | 'later'): void {
  /* Another generation stands at the archive's path now: nothing the window
     holds belongs to it, whatever its sequence. */
  if (viewGeneration !== undefined && batch.generation !== viewGeneration) resetWindow()
  viewGeneration = batch.generation
  const known = new Set(batch.items.map(item => item.eventId))
  if (at === 'latest') {
    /* What this module instance appended while the read was in flight is
       newer than the batch and stays. */
    const newest = batch.items.at(-1)?.sequence ?? 0
    timeline = [
      ...batch.items,
      ...timeline.filter(item => !known.has(item.eventId) && item.sequence > newest),
    ]
    timelineEdges = { earlier: batch.earlier, later: false }
    parentRuns = new Map()
    segmentOrigins = new Map()
  } else if (at === 'earlier') {
    timeline = [...batch.items, ...timeline.filter(item => !known.has(item.eventId))]
    timelineEdges.earlier = batch.earlier
  } else {
    timeline = [...timeline.filter(item => !known.has(item.eventId)), ...batch.items]
    timelineEdges.later = batch.later
  }
  timeline.sort((left, right) => left.sequence - right.sequence)
  for (const [eventId, runId] of batch.parents) parentRuns.set(eventId, runId)
  for (const [eventId, runId] of batch.origins) segmentOrigins.set(eventId, runId)
  if (batch.path) {
    const same = at !== 'latest' && activePath?.tip === batch.path.tip
    activePath = {
      tip: batch.path.tip,
      eventIds: new Set([...(same ? activePath!.eventIds : []), ...batch.path.eventIds]),
      start: batch.path.start,
    }
  } else {
    activePath = undefined
  }
  boundWindow(at === 'earlier' ? 'earlier' : 'later')
}

/* The latest batch of the Project Timeline, read back so a reload or a new
   process shows what the archive already holds, and so the band returns to
   its bottom. Read only with consent: before it the archive is not this
   plugin's to look into. */
async function loadTimeline(
  $: EngineInterface,
  currentProject: ProjectState,
): Promise<void> {
  if (currentProject.consent !== 'enabled' || !startup.helperPath || !startup.databaseRoot) {
    return
  }
  /* The branch first, so the read places its tip and path. */
  try {
    await loadBranchView($, currentProject)
  } catch {
    // Without it the band draws every entry unfolded, which hides nothing.
  }
  mergeBatch(await readBatch($, currentProject), 'latest')
  timelineLoaded = currentProject.id
}

/* The batch beyond one end of the window, when the person's view or focus
   reached that end. The view is kept by its first row's key, so what arrives
   lands out of sight beyond the rows on screen and the next step continues
   into it. One load at a time; answers whether the window grew. */
async function extendWindow($: EngineInterface, edge: 'earlier' | 'later'): Promise<boolean> {
  if (windowLoading || !project || timelineLoaded !== project.id) return false
  const edgeItem = edge === 'earlier' ? timeline[0] : timeline.at(-1)
  if (!edgeItem) return false
  windowLoading = true
  try {
    const batch = await readBatch(
      $,
      project,
      edge === 'earlier' ? ['before', edgeItem.sequence] : ['after', edgeItem.sequence],
    )
    /* A cursor means nothing in another generation: the view starts again
       from that generation's latest events. */
    if (batch.generation !== viewGeneration) {
      mergeBatch(await readBatch($, project), 'latest')
    } else {
      mergeBatch(batch, edge)
    }
    $.ui.invalidate('ui.render')
    return true
  } catch {
    // The window stays as it was; the next step at the edge tries again.
    return false
  } finally {
    windowLoading = false
  }
}

/* Moves the band's own view by `by` rows, as the wheel, the trackpad or the
   engine's scroll keys ask, and fetches the batch beyond an end it reaches. */
async function scrollView($: EngineInterface, by: number): Promise<void> {
  const last = Math.max(0, bandView.rowKeys.length - bandView.capacity)
  bandTop = Math.min(Math.max(bandTop + by, 0), last)
  bandAnchor = bandView.rowKeys[bandTop]
  bandBottom = false
  $.ui.invalidate('ui.render')
  if (bandTop === 0 && timelineEdges.earlier) await extendWindow($, 'earlier')
  else if (bandTop === last && timelineEdges.later) await extendWindow($, 'later')
}

/* The title row's way up from the band's bottom, where no scrolling reaches
   it: a page up, the ring on the title so the arrows walk from there. */
async function pageUp($: EngineInterface): Promise<void> {
  await scrollView($, -bandView.capacity)
  try {
    if (!(await $.ui.focus({ requestId: bandView.requestId ?? '', key: TITLE_KEY })).deny) {
      ringKey = TITLE_KEY
    }
  } catch {
    // The ring stays where the press left it.
  }
}

/* One arrow press walking the ring: to the neighbouring stop, fetching the
   batch beyond first when the ring stands on the window's last stop that way.
   The view follows the ring, and reaching the window's end stop fetches
   ahead, so the walk does not pause there. With no stop left that way, the
   press scrolls the view a row instead, onto the rows past the last stop. */
async function stepRing($: EngineInterface, by: 1 | -1): Promise<void> {
  let stops = stopKeys(bandRows())
  let target = arrowStep(stops, ringKey, by, timelineEdges.earlier)
  const edge = by < 0 ? 'earlier' : 'later'
  if (target === undefined && ringKey !== undefined && stops.includes(ringKey)
      && timelineEdges[edge] && await extendWindow($, edge)) {
    stops = stopKeys(bandRows())
    target = arrowStep(stops, ringKey, by, timelineEdges.earlier)
  }
  if (target === undefined) {
    await scrollView($, by)
    return
  }
  if (target === TITLE_KEY || bandView.shown.includes(target)) {
    try {
      if (!(await $.ui.focus({ requestId: bandView.requestId ?? '', key: target })).deny) {
        ringKey = target
      }
    } catch {
      // The ring stays where it was.
    }
  } else {
    pendingFocus = target
    $.ui.invalidate('ui.render')
  }
  if (target === stops[0] && timelineEdges.earlier) await extendWindow($, 'earlier')
  else if (target === stops.at(-1) && timelineEdges.later) await extendWindow($, 'later')
}

/* Back to the latest events, the band's bottom. */
/* `reread` is an opening band's: another Run may have archived meanwhile, and
   no signal crosses processes, so the latest batch is read even when the
   window believes it already holds it. */
async function returnToLatest($: EngineInterface, reread = false): Promise<void> {
  if ((timelineEdges.later || reread) && project && timelineLoaded === project.id) {
    try {
      mergeBatch(await readBatch($, project), 'latest')
    } catch {
      // The window and its count stay as they were, for another try.
      $.ui.invalidate('ui.render')
      return
    }
  }
  unread = 0
  bandBottom = true
  $.ui.invalidate('ui.render')
}

/* An event this process just archived. The window takes it only when it
   continues the window's last event: anything another Run wrote in between
   would otherwise go missing unseen. At the bottom, a gap re-reads the latest
   batch; elsewhere it leaves the window where it is. A Prompt Entry that
   arrives while the band is looking elsewhere is counted. */
function appendToWindow($: EngineInterface, item: TimelineItem): void {
  if (item.kind === 'prompt') queueAlignment($)
  if (timeline.some(held => held.eventId === item.eventId)) return
  /* A repeated boundary answers the sequence it was stored under: already
     archived, and drawn wherever a read places it. A write that finished
     after a later one is placed by its sequence among the events the window
     holds around it. */
  const newest = timeline.at(-1)
  if (newest && item.sequence <= newest.sequence) {
    if (item.sequence > timeline[0]!.sequence) {
      timeline = [...timeline, item].sort((left, right) => left.sequence - right.sequence)
      boundWindow(!expanded || bandBottom ? 'later' : 'earlier')
      $.ui.invalidate('ui.render')
    }
    return
  }
  const following = expanded && bandBottom
  if (item.kind === 'prompt') {
    if (expanded && !following) unread += 1
    if (activePath && item.parentEventId === activePath.tip) {
      activePath.tip = item.eventId
      activePath.eventIds.add(item.eventId)
      if (activePath.start === null && item.runId === startup.runId) activePath.start = item.sequence
    } else {
      activePath = undefined
    }
  }
  const last = timeline.at(-1)
  const loaded = project !== undefined && timelineLoaded === project.id
  const continues = !timelineEdges.later
    && (!loaded || (last ? last.sequence + 1 === item.sequence : item.sequence === 1))
  if (continues) {
    /* Away from the bottom a full window keeps the rows in view and lets the
       newest go instead: the count and the band's bottom reach it. */
    timeline = [...timeline, item]
    boundWindow(!expanded || following ? 'later' : 'earlier')
  } else if (following && project) {
    const currentProject = project
    $.clock.after(0, () => {
      void (async () => {
        try {
          mergeBatch(await readBatch($, currentProject), 'latest')
          bandBottom = true
          $.ui.invalidate('ui.render')
        } catch {
          // The window keeps what it had; the band's bottom row reaches the rest.
        }
      })()
    })
  } else {
    timelineEdges.later = true
  }
  $.ui.invalidate('ui.render')
}

async function saveReconcile(
  $: EngineInterface,
  currentProject: ProjectState,
  state: ReconcileState,
  text: string | undefined,
): Promise<void> {
  reconcile = { state, text }
  try {
    await $.store.set(reconcileKey(currentProject.id), state)
  } catch {
    /* The in-memory block still holds for this module instance; a reload
       re-discovers the pending from the archive. */
  }
}

async function clearReconcile(
  $: EngineInterface,
  currentProject: ProjectState,
): Promise<void> {
  reconcile = undefined
  /* A crash can leave more than one Run's pending behind, and only the first
     was taken. Settling one re-opens the question rather than letting the rest
     pass unnoticed; the extra listing costs a subprocess only after an actual
     reconciliation. */
  pendingDiscovered = false
  try {
    await $.store.delete(reconcileKey(currentProject.id))
  } catch {
    // The archive no longer holds the pending, so a stale record self-heals.
  }
}

async function abortCapture(
  $: EngineInterface,
  currentProject: ProjectState,
  eventId: string,
): Promise<void> {
  if (!startup.helperPath || !startup.databaseRoot) return
  const result = await runArchive(
    $,
    [
      startup.helperPath,
      'capture-abort',
      startup.databaseRoot,
      currentProject.id,
      eventId,
      EXPECTED_HELPER_SHA256,
      String(HELPER_PROTOCOL),
    ],
    10_000,
  )
  if (result.exitCode !== 0) throw new Error(safeCategory(result.stderr, 'capture-abort'))
  await archiveRecovered($, currentProject)
}

/* Another Run offered the same pending and settled it first: a confirmation
   finds it gone, an abort finds it confirmed. Its answer stands, and this
   Run has nothing left to settle. */
function settledElsewhere(error: unknown, operation: 'confirm' | 'abort'): boolean {
  return error instanceof Error
    && error.message === (operation === 'confirm' ? 'capture-not-found' : 'capture-conflict')
}

/* `$.session.messages()` answers at most the latest 4096 rows and mixes the
   engine's own `user` rows in with the person's, so it proves an outcome only
   in the two unambiguous shapes: the staged text appears exactly once, or it
   appears nowhere in a transcript short enough to be whole. Anything else is
   for the person to settle. */
const TRANSCRIPT_LIMIT = 4096

function transcriptVerdict(
  messages: readonly { role: string; text: string }[],
  text: string,
): 'entered' | 'absent' | 'ambiguous' {
  const matches = messages.filter(
    message => message.role === 'user' && message.text === text,
  ).length
  if (matches === 1) return 'entered'
  if (matches === 0 && messages.length < TRANSCRIPT_LIMIT) return 'absent'
  return 'ambiguous'
}

/* Settling one Pending Capture. It answers whether the Run may collect again;
   every path that does not reach a definite answer leaves the block in place
   rather than guessing, and no path resubmits the prompt that was dropped. */
async function reconcilePending(
  $: EngineInterface,
  currentProject: ProjectState,
): Promise<'resolved' | 'blocked'> {
  const owed = reconcile
  if (!owed) return 'resolved'

  const confirmPending = async (): Promise<'resolved' | 'blocked'> => {
    try {
      const confirmed = await confirmCapture(
        $,
        currentProject,
        owed.state.eventId,
        owed.text,
      )
      /* Only the Run that staged it may chain its own Active Branch onto the
         entry; another Run's branch is not this reconciliation's to move. */
      if (startup.runId === owed.state.runId && startup.sessionId) {
        const key = branchKey(currentProject.id, startup.runId, startup.sessionId)
        const settled: BranchState = {
          version: 1,
          branchId: owed.state.branchId,
          parentEventId: owed.state.eventId,
        }
        await $.store.set(key, settled)
        rememberBranch(key, settled)
      }
      if (owed.text !== undefined) {
        appendToWindow($, {
          kind: 'prompt',
          eventId: owed.state.eventId,
          sequence: confirmed.sequence,
          ordinal: confirmed.ordinal,
          runId: owed.state.runId,
          branchId: owed.state.branchId,
          parentEventId: owed.state.parentEventId,
          text: owed.text,
          attachmentCount: owed.state.attachmentCount,
        })
      }
      await clearReconcile($, currentProject)
      return 'resolved'
    } catch (error) {
      if (!settledElsewhere(error, 'confirm')) return 'blocked'
      await clearReconcile($, currentProject)
      return 'resolved'
    }
  }

  const discardPending = async (): Promise<'resolved' | 'blocked'> => {
    try {
      await abortCapture($, currentProject, owed.state.eventId)
    } catch (error) {
      if (!settledElsewhere(error, 'abort')) return 'blocked'
    }
    await clearReconcile($, currentProject)
    return 'resolved'
  }

  let verdict: 'entered' | 'absent' | 'ambiguous' = 'ambiguous'
  if (owed.text !== undefined) {
    try {
      verdict = transcriptVerdict(await $.session.messages(), owed.text)
    } catch {
      verdict = 'ambiguous'
    }
  }
  if (verdict === 'entered') return confirmPending()
  if (verdict === 'absent') return discardPending()

  let answer: string | undefined
  try {
    answer = await $.ui.ask(
      [
        'Prompt Trail 有一条未决的 Pending Capture：提交已交给 Claude Code，但归档确认没有完成。',
        `事件 ID：${owed.state.eventId.slice(0, 8)}`,
        '时间线无法唯一证明这条提交是否进入会话，请选择如何记录它。',
        '“已进入”归档为 Prompt Entry；“未进入”丢弃这条 pending；',
        '“新根分支”同样不归档，并让其后的 prompt 从新的根 Conversation Branch 开始。',
      ].join('\n'),
      {
        header: '未决 Pending Capture',
        options: ['已进入', '未进入', '新根分支'],
      },
    )
  } catch {
    return 'blocked'
  }

  if (answer === '已进入') return confirmPending()
  if (answer === '未进入') return discardPending()
  if (answer === '新根分支') {
    /* Nothing after an outcome nobody could vouch for is chained onto it. The
       new root is written first: if that write fails the pending is still
       there, so the block holds and the choice is not silently lost. */
    if (startup.runId && startup.sessionId) {
      try {
        await $.store.set(
          branchKey(currentProject.id, startup.runId, startup.sessionId),
          {
            version: 1,
            branchId: crypto.randomUUID(),
            parentEventId: null,
            explicitRoot: true,
          } satisfies BranchState,
        )
      } catch {
        return 'blocked'
      }
    }
    return discardPending()
  }
  /* A closed or cancelled dialog is not an answer: the Run stays blocked. */
  return 'blocked'
}

/* Whether anything is owed before this Run archives its first prompt. The
   archive is asked once, because a previous process may have left a pending
   without ever writing its `$.store` record. */
async function discoverPending(
  $: EngineInterface,
  currentProject: ProjectState,
): Promise<void> {
  if (pendingDiscovered || reconcile) return
  let owed: ReconcileState[]
  try {
    const listed = await listPending($, currentProject)
    owed = listed.owed
    pendingElsewhere = listed.skipped
  } catch (error) {
    pendingUnknown = failureCategory(error, 'capture-list')
    pendingElsewhere = undefined
    throw error
  }
  /* A listing that left another live Run's pending out is not the last word:
     that Run may exit without settling it, and the pending is then this
     Run's to settle, so the next submission asks again. */
  pendingDiscovered = pendingElsewhere === 0
  pendingUnknown = undefined
  const first = owed[0]
  /* Persisted, not just held in memory: a reconciliation that gets partway —
     the entry confirmed but its branch not yet written — must still be owed
     after a restart, and by then the archive no longer lists it. */
  if (first) await saveReconcile($, currentProject, first, undefined)
}

/* A crash can leave one pending per Run behind, so settling one re-asks the
   archive rather than assuming it was the only one. The bound is the helper's
   own fixed batch, which is also the most a single listing can report. */
const PENDING_SETTLE_LIMIT = 64

async function settlePending(
  $: EngineInterface,
  currentProject: ProjectState,
): Promise<'clear' | 'settled' | 'blocked'> {
  /* A pending staged in a generation since replaced went with it into
     quarantine: nothing is owed for it in the one now in place. */
  const owedIn = reconcile?.state.generation
  if (owedIn && (await readArchiveStatus($, currentProject)).generation !== owedIn) {
    await clearReconcile($, currentProject)
  }
  let settledAny = false
  for (let attempt = 0; attempt < PENDING_SETTLE_LIMIT; attempt += 1) {
    await discoverPending($, currentProject)
    if (!reconcile) return settledAny ? 'settled' : 'clear'
    if (await reconcilePending($, currentProject) === 'blocked') return 'blocked'
    settledAny = true
  }
  return 'blocked'
}

function parseBranchMatch(text: string, projectId: string): BranchMatch {
  const value: unknown = JSON.parse(text)
  if (
    !isRecord(value) ||
    value.projectId !== projectId ||
    !Array.isArray(value.candidates) ||
    !Number.isSafeInteger(value.candidateCount)
  ) throw new Error('branch-match')
  const candidates = value.candidates.map(candidate => {
    if (
      !isRecord(candidate) ||
      !isSafeId(candidate.eventId) ||
      !isSafeId(candidate.runId) ||
      !Number.isSafeInteger(candidate.sequence) ||
      !Number.isSafeInteger(candidate.ordinal)
    ) throw new Error('branch-match')
    return {
      eventId: candidate.eventId,
      runId: candidate.runId,
      sequence: candidate.sequence as number,
      ordinal: candidate.ordinal as number,
    }
  })
  const candidateCount = value.candidateCount as number
  const preferred = value.prefer
  if (preferred !== undefined && (
    !isRecord(preferred) ||
    !isSafeId(preferred.eventId) ||
    !Number.isSafeInteger(preferred.sequence) ||
    !Number.isSafeInteger(preferred.ordinal)
  )) throw new Error('branch-match')
  const prefer = {
    generation: nullableGeneration(value.generation, 'branch-match'),
    ...(preferred === undefined
      ? {}
      : {
          prefer: {
            eventId: preferred.eventId as string,
            sequence: preferred.sequence as number,
            ordinal: preferred.ordinal as number,
          },
        }),
  }
  if (value.match === 'unique' && isSafeId(value.eventId)) {
    return { match: 'unique', eventId: value.eventId, candidates, candidateCount, ...prefer }
  }
  if (value.match === 'none' || value.match === 'ambiguous') {
    return { match: value.match, candidates, candidateCount, ...prefer }
  }
  throw new Error('branch-match')
}

/* Which archived Prompt Entry the transcript ends on. A session with a lineage
   of its own is matched inside its own stretch of the Run first; one without
   (a fork, or a session that never archived) across the project. The rows
   travel on stdin only. */
async function matchBranch(
  $: EngineInterface,
  currentProject: ProjectState,
  stored: BranchState | undefined,
  compacted: boolean,
  messages: readonly SessionMessage[],
): Promise<BranchMatch> {
  const stdout = await runBranchMatch(
    $, currentProject, stored, compacted, transcriptRows(messages), stored?.parentEventId != null, false,
  )
  return parseBranchMatch(stdout, currentProject.id)
}

/* `scoped` looks inside this session's stretch of the Run first (the helper
   widens to the project when the session archived nothing there); `aligned`
   asks also for the row each entry of the lineage took. */
async function runBranchMatch(
  $: EngineInterface,
  currentProject: ProjectState,
  stored: BranchState | undefined,
  compacted: boolean,
  rows: { stdin: string; truncated: boolean },
  scoped: boolean,
  aligned: boolean,
): Promise<string> {
  if (!startup.helperPath || !startup.databaseRoot || !startup.runId || !startup.sessionId) {
    throw new Error('capture-identity')
  }
  const result = await runArchive(
    $,
    [
      startup.helperPath,
      'branch-match',
      startup.databaseRoot,
      currentProject.id,
      scoped ? startup.runId : '-',
      scoped ? startup.sessionId : '-',
      /* Compaction drops the earliest rows just as the engine's limit does. */
      rows.truncated || compacted ? 'truncated' : 'whole',
      stored?.parentEventId ?? '-',
      EXPECTED_HELPER_SHA256,
      String(HELPER_PROTOCOL),
      '--stdin',
      ...(aligned ? ['--rows'] : []),
    ],
    10_000,
    rows.stdin,
  )
  if (result.exitCode !== 0) throw new Error(safeCategory(result.stderr, 'branch-match'))
  return result.stdout
}

/* The rows `branch-match --rows` placed: a row of its input and the entry
   that took it. */
function parseAlignedRows(text: string, projectId: string): { row: number; eventId: string }[] {
  const value: unknown = JSON.parse(text)
  if (!isRecord(value) || value.projectId !== projectId || !Array.isArray(value.rows)) {
    throw new Error('branch-match')
  }
  return value.rows.map((row: unknown) => {
    if (
      !isRecord(row) ||
      !Number.isSafeInteger(row.row) ||
      (row.row as number) < 0 ||
      !isSafeId(row.eventId)
    ) throw new Error('branch-match')
    return { row: row.row as number, eventId: row.eventId }
  })
}

/* Ties the rows drawn so far to Prompt Entries, once whatever is drawing or
   settling right now has finished. */
function queueAlignment($: EngineInterface): void {
  if (alignmentQueued) return
  alignmentQueued = true
  $.clock.after(0, () => {
    alignmentQueued = false
    void alignJumpTargets($)
  })
}

async function alignJumpTargets($: EngineInterface): Promise<void> {
  if (alignment) {
    alignment.again = true
    return
  }
  const running = { again: true }
  alignment = running
  try {
    while (running.again) {
      running.again = false
      await alignOnce($)
    }
  } finally {
    alignment = undefined
  }
}

/* Drops the rows the transcript no longer holds, then asks the helper which
   entry each remaining row is, matched the way this session's branch is
   settled. A rewind or a clear says nothing, so the transcript is read each
   time. An alignment that fails keeps the targets already proven: a row that
   has gone since is refused when jumped to. */
async function alignOnce($: EngineInterface): Promise<void> {
  const currentProject = project
  if (
    startup.support !== 'supported' ||
    currentProject?.consent !== 'enabled' ||
    !startup.runId ||
    !startup.sessionId ||
    drawnRows.length === 0
  ) return
  let generation = drawnGeneration
  /* Only rows drawn before the read: one drawn while it was on its way may
     be missing from it without being gone. */
  const asked = drawnRows.slice()
  try {
    const held = (await $.session.messages()).filter(isPersonRow).map(message => message.text)
    if (generation === drawnGeneration) forgetRows($, vanishedRows(asked, held))
  } catch {
    // Unread, the transcript proves nothing gone; a jump still finds out.
  }
  if (drawnRows.length === 0) return
  generation = drawnGeneration
  const rows = drawnRows.slice()
  const input = alignmentInput(rows)
  const key = branchKey(currentProject.id, startup.runId, startup.sessionId)
  const stored = activeBranch?.key === key ? activeBranch.value : undefined
  let aligned: { row: number; eventId: string }[]
  try {
    const compacted = await sessionCompacted($, currentProject.id, startup.sessionId)
    /* Scoped even for a root somebody chose: its rows are tied among the
       session's own entries before anyone else's. */
    const stdout = await runBranchMatch($, currentProject, stored, compacted, input, true, true)
    aligned = parseAlignedRows(stdout, currentProject.id)
  } catch {
    return
  }
  if (generation !== drawnGeneration) return
  const table = jumpTargets(rows, input.indices, aligned, goneRows)
  if (table.size === jumpTable.size && [...table].every(([eventId, requestId]) => jumpTable.get(eventId) === requestId)) {
    return
  }
  jumpTable = table
  $.ui.invalidate('ui.render')
}

/* Whether the transcript still holds the rows with targets: a row it lost
   takes its target with it, and the rest are tied again. */
function queueRecheck($: EngineInterface): void {
  if (recheckQueued || jumpTable.size === 0) return
  recheckQueued = true
  $.clock.after(0, () => void recheckRows($))
  $.clock.after(RECHECK_INTERVAL, () => {
    recheckQueued = false
    void recheckRows($)
  })
}

async function recheckRows($: EngineInterface): Promise<void> {
  if (jumpTable.size === 0) return
  const generation = drawnGeneration
  const asked = drawnRows.slice()
  let held: string[]
  try {
    held = (await $.session.messages()).filter(isPersonRow).map(message => message.text)
  } catch {
    return
  }
  if (generation !== drawnGeneration) return
  const vanished = vanishedRows(asked, held)
  forgetRows($, vanished)
  if (vanished.length > 0) queueAlignment($)
}

/* The transcript started over: a clear, a resume into another session, an
   exit. Nothing drawn before is where it was, and the engine may draw some
   of it once more on the way out, so all of it is gone for good. */
function forgetDrawnRows($: EngineInterface): void {
  for (const row of drawnRows) goneRows.add(row.requestId)
  drawnRows = []
  drawnGeneration += 1
  if (jumpTable.size > 0) $.ui.invalidate('ui.render')
  jumpTable = new Map()
}

/* Rows the transcript lost: no longer kept, and no entry's target. */
function forgetRows($: EngineInterface, requestIds: readonly string[]): void {
  if (requestIds.length === 0) return
  const lost = new Set(requestIds)
  for (const requestId of lost) goneRows.add(requestId)
  drawnRows = drawnRows.filter(row => !lost.has(row.requestId))
  const before = jumpTable.size
  jumpTable = new Map([...jumpTable].filter(([, requestId]) => !lost.has(requestId)))
  if (jumpTable.size !== before) $.ui.invalidate('ui.render')
}

/* Activating a Prompt Entry: back to its row in the transcript, the band
   folding away once the engine got there. A row the engine refused is gone,
   and its entry is marked as no longer reachable; a call that failed proves
   nothing and changes nothing. An entry without a target does nothing. */
async function jumpTo($: EngineInterface, eventId: string): Promise<void> {
  const requestId = jumpTable.get(eventId)
  if (requestId === undefined) return
  let result: { deny?: string } | undefined
  try {
    result = await $.ui.scroll({ to: { requestId } })
  } catch {
    result = undefined
  }
  const outcome = jumpOutcome(result)
  if (outcome === 'collapse') {
    expanded = false
    $.ui.invalidate('ui.render')
    await saveExpanded($)
  } else if (outcome === 'stale') {
    forgetRows($, [requestId])
  }
}

/* How a candidate parent is offered: by its sequence and a single line of its
   text while the loaded window holds it, by its event id otherwise. */
const PARENT_LABEL_WIDTH = 40

/* A candidate by its number in the band and its text while the window holds
   it; otherwise by the number the helper answered and its event id. */
function parentLabel(eventId: string, found: BranchMatch): string {
  const entry = timeline.find(item => item.kind === 'prompt' && item.eventId === eventId)
  if (entry?.kind === 'prompt') {
    const line = entryLine(entry)
    const text = line.length > PARENT_LABEL_WIDTH ? `${line.slice(0, PARENT_LABEL_WIDTH - 1)}…` : line
    return `#${entry.ordinal} ${text}`
  }
  const ordinal = found.candidates.find(item => item.eventId === eventId)?.ordinal
    ?? (found.prefer?.eventId === eventId ? found.prefer.ordinal : undefined)
  return ordinal !== undefined
    ? `#${ordinal} 事件 ${eventId.slice(0, 8)}`
    : `事件 ${eventId.slice(0, 8)}`
}

const PARENT_PANE_ID = 'prompt-trail-parent'

/* Settles this session's Active Branch against its transcript before every
   capture: in full the first time this module instance meets the session,
   and after that whenever the transcript no longer holds the last captured
   prompt where it landed, which is what a rewind leaves. Answers a result
   that drops the submission, or the transcript it was settled against. A
   stored lineage the transcript cannot place is put to the person in a
   Pane: the submission is dropped, its draft held until they choose, and
   never resubmitted. Whatever this submission settles, a choice an earlier
   one left waiting is superseded by it. */
async function alignBranch(
  $: EngineInterface,
  currentProject: ProjectState,
  draft: string,
): Promise<Alignment> {
  const waiting = parentChoice
  try {
    return await settleAlignment($, currentProject, draft)
  } finally {
    if (waiting && parentChoice === waiting) await dismissParentChoice($)
  }
}

/* What aligning the Active Branch came to: the transcript it read, a drop the
   Pane or a refusal already answered, or a failure the submission is held
   over, with the person's choice to retry. */
type Alignment =
  | { messages: readonly SessionMessage[] }
  | { drop: string }
  | { failed: string }

async function settleAlignment(
  $: EngineInterface,
  currentProject: ProjectState,
  draft: string,
): Promise<Alignment> {
  if (!startup.runId || !startup.sessionId) return { failed: 'capture-identity' }
  const key = branchKey(currentProject.id, startup.runId, startup.sessionId)
  let messages: readonly SessionMessage[]
  try {
    messages = await $.session.messages()
  } catch {
    return { failed: 'transcript-unreadable' }
  }
  const settled = () => {
    transcriptMark = { key, mark: markTranscript(messages) }
  }
  if (recompacted.delete(startup.sessionId) && transcriptMark?.key === key) {
    settled()
    return { messages }
  }
  if (transcriptMark?.key === key && transcriptKept(messages, transcriptMark.mark)) {
    return { messages }
  }

  let stored: BranchState | undefined
  let found: BranchMatch
  let settlement: ReturnType<typeof settleBranch>
  try {
    stored = storedBranch(await $.store.get(key))
    if (trustsStoredBranch(stored)) {
      settled()
      if (stored) rememberBranch(key, stored)
      return { messages }
    }
    const compacted = await sessionCompacted($, currentProject.id, startup.sessionId)
    found = await matchBranch($, currentProject, stored, compacted, messages)
    /* The branch was staged in a generation since replaced: nothing in the
       one now in place is its lineage, so it starts over there rather than
       be matched, or put to the person, against it. */
    if (stored?.generation && found.generation !== stored.generation) {
      const root = await enterNewGeneration($, currentProject, stored.generation)
      settled()
      rememberBranch(root.key, root.value)
      return { messages }
    }
    settlement = settleBranch(stored, found, crypto.randomUUID(), compacted)
    if (settlement.kind === 'set') {
      /* Its parent is in the generation it was matched in. */
      const state: BranchState = found.generation
        ? { ...settlement.state, generation: found.generation }
        : settlement.state
      await $.store.set(key, state)
      rememberBranch(key, state)
      queueAlignment($)
    } else if (settlement.kind === 'keep' && stored) {
      rememberBranch(key, stored)
    }
  } catch (error) {
    return { failed: failureCategory(error, 'branch-match') }
  }
  if (settlement.kind !== 'ask') {
    settled()
    return { messages }
  }

  const choice: ParentChoice = {
    key,
    sessionId: startup.sessionId,
    stored,
    ...(found.generation ? { generation: found.generation } : {}),
    candidates: settlement.options.map(eventId => ({ eventId, label: parentLabel(eventId, found) })),
    /* What the helper counted but never named. */
    unlisted: Math.max(0, found.candidateCount - found.candidates.length),
    mark: markTranscript(messages),
    draft,
  }
  parentChoice = choice
  try {
    await $.ui.open({
      id: PARENT_PANE_ID,
      title: '确认父节点',
      focus: true,
      closeOnEscape: true,
      holdToasts: true,
      rows: choice.candidates.length + (choice.unlisted > 0 ? 5 : 4),
    })
  } catch {
    await dismissParentChoice($)
    return {
      drop: `Prompt Trail 无法打开「确认父节点」面板，${draftNote(await restoreDraft($, draft))}；本次提交未进入会话。`,
    }
  }
  $.ui.invalidate('ui.render')
  return {
    drop: 'Prompt Trail 无法唯一确定下一条 prompt 的父节点，请在「确认父节点」面板中选择；草稿已暂存，选择后放回输入框，不会自动重发。',
  }
}

/* Closes the Pane of a choice nobody will make any more. Its draft goes with
   it: whatever superseded the choice holds a newer one, or has none to give. */
async function dismissParentChoice($: EngineInterface): Promise<void> {
  if (!parentChoice) return
  parentChoice = undefined
  try {
    await $.ui.close({ id: PARENT_PANE_ID })
  } catch {
    // A hook kept it open; with no choice behind it, it only says so.
  }
}

/* The person's choice in the Pane. It is carried out once the press has been
   answered, so the Pane is closed from outside its own dispatch; a second
   press meanwhile is the same choice, and is ignored. */
function chooseParent($: EngineInterface, choice: ParentChoice, answer: string | 'root'): void {
  if (parentChoice !== choice || choice.settling) return
  choice.settling = true
  $.clock.after(0, () => {
    void settleParentChoice($, choice, answer)
  })
}

async function settleParentChoice(
  $: EngineInterface,
  choice: ParentChoice,
  answer: string | 'root',
): Promise<void> {
  if (parentChoice !== choice) return
  let current: string | undefined
  try {
    current = await $.session.id()
  } catch {
    current = undefined
  }
  /* The session moved on, or a reconciliation is owed, since it was asked:
     the candidates no longer describe the branch the next prompt joins. */
  if (parentChoice !== choice) return
  if (current !== choice.sessionId || reconcile) {
    await dismissParentChoice($)
    const restored = await restoreDraft($, choice.draft)
    $.ui.toast(`Prompt Trail 的父节点确认已失效，${draftNote(restored)}；再次提交时会重新判断。`)
    return
  }
  try {
    const picked = chooseBranch(choice.stored, answer, crypto.randomUUID())
    const chosen: BranchState = choice.generation && picked.parentEventId !== null
      ? { ...picked, generation: choice.generation }
      : picked
    await $.store.set(choice.key, chosen)
    rememberBranch(choice.key, chosen)
    queueAlignment($)
  } catch {
    choice.settling = undefined
    choice.error = '无法保存所选父节点；可以重试，或按 Esc 取消。'
    $.ui.invalidate('ui.render')
    return
  }
  transcriptMark = { key: choice.key, mark: choice.mark }
  await dismissParentChoice($)
  const restored = await restoreDraft($, choice.draft)
  $.ui.toast(`Prompt Trail 已确认父节点，${draftNote(restored)}；请检查后重新提交。`)
}

async function sessionCompacted(
  $: EngineInterface,
  projectId: string,
  sessionId: string,
): Promise<boolean> {
  const key = compactedKey(projectId, sessionId)
  if ((await $.store.get(key)) === true) return true
  /* A session the conversation was moved to carries the transcript of the one
     it came from, compaction and all. */
  const inherited = sessionId === startup.sessionId
    && startup.continuedFrom !== undefined
    && (await $.store.get(compactedKey(projectId, startup.continuedFrom))) === true
  if (!inherited && !compactedSessions.has(sessionId)) return false
  try {
    await $.store.set(key, true)
    compactedSessions.delete(sessionId)
  } catch {
    // This module instance still knows; the next one may not.
  }
  return true
}

/* Marks a classic session compacted: in memory before anything else is
   awaited, so a submission that meets the compacted transcript already knows,
   and kept there until the store holds it. */
async function markCompacted($: EngineInterface, sessionId: string): Promise<void> {
  compactedSessions.add(sessionId)
  recompacted.add(sessionId)
  try {
    const projectId = project?.id
      ?? (runtimeTarget ? await sha256(await canonicalProjectRoot($, runtimeTarget.cwd)) : undefined)
    if (!projectId) return
    await $.store.set(compactedKey(projectId, sessionId), true)
    compactedSessions.delete(sessionId)
  } catch {
    // Written on the next alignment instead.
  }
}

function rememberBranch(key: string, value: BranchState): void {
  /* The marker is read from the branch a session is on, so a session that
     moves off an unlinked root stops marking it, as a reload would. */
  const previous = activeBranch?.key === key ? activeBranch.value : undefined
  if (previous?.rootReason === 'ambiguous-prefix' && previous.branchId !== value.branchId) {
    ambiguousRoots.delete(previous.branchId)
  }
  activeBranch = { key, value }
  if (value.rootReason === 'ambiguous-prefix') ambiguousRoots.add(value.branchId)
}

/* Reads back what the band folds against after a reload or a restart: this
   session's branch, and every branch recorded as an unlinked fork root. */
async function loadBranchView($: EngineInterface, currentProject: ProjectState): Promise<void> {
  const prefix = `prompt-trail:branch:${currentProject.id}:`
  for (const key of await $.store.keys()) {
    if (!key.startsWith(prefix)) continue
    const value = storedBranch(await $.store.get(key))
    if (value?.rootReason === 'ambiguous-prefix') ambiguousRoots.add(value.branchId)
  }
  if (startup.runId && startup.sessionId) {
    const key = branchKey(currentProject.id, startup.runId, startup.sessionId)
    const value = storedBranch(await $.store.get(key))
    if (value) rememberBranch(key, value)
  }
}

/* The Clear Boundary's idempotency key, derived from the classic session that
   is ending. Every replay of the same `/clear` — a repeated event, a retry from
   the recovery queue, a later process draining what this one could not write —
   names the same event id, so `boundary-append` answers the stored sequence
   instead of cutting the segment twice. */
async function clearEventId(projectId: string, sessionId: string): Promise<string> {
  return sha256(`prompt-trail:clear-boundary:1:${projectId}:${sessionId}`)
}

/* A Run boundary's idempotency key. The start is derived from the Run alone,
   because a Run appears only once; an attach or a detach also from the
   attachment it opens or closes, because the same process may leave a Run and
   come back to it. Every replay — a retry from the recovery queue, a reload
   asking again, a later process draining what an exiting one could not write —
   names the same event. */
async function runBoundaryEventId(
  kind: 'run-started' | 'run-attached' | 'run-detached',
  projectId: string,
  runId: string,
  attachmentId: string,
): Promise<string> {
  return sha256(kind === 'run-started'
    ? `prompt-trail:run-started:1:${projectId}:${runId}`
    : `prompt-trail:${kind}:1:${projectId}:${runId}:${attachmentId}`)
}

/* Closing whatever this process left open in another Run of the project. An
   in-process `/resume` into another Run's session leaves the Run it came from,
   and only now, with this Run current, is that known. The detach is queued on
   the Run it belongs to, and the drain lands it ahead of anything this Run
   writes. Answers whether nothing is left open. */
async function detachAbandonedRuns(
  $: EngineInterface,
  currentProject: ProjectState,
): Promise<boolean> {
  const host = startup.hostGeneration
  if (!host) return false
  const prefix = lifecyclePrefix(currentProject.id)
  try {
    for (const record of await foreignLifecycles($, currentProject)) {
      const attachment = record.value.attachment
      if (!attachment || attachment.closed || attachment.host !== host) continue
      const abandonedRunId = record.key.slice(prefix.length)
      const branch = storedBranch(await $.store.get(
        branchKey(currentProject.id, abandonedRunId, attachment.segmentId),
      ))
      const decision = detachAbandoned(
        record.value,
        { runId: abandonedRunId, host },
        {
          eventId: await runBoundaryEventId(
            'run-detached',
            currentProject.id,
            abandonedRunId,
            attachment.id,
          ),
          branchId: branch?.branchId ?? attachment.id,
          occurredAt: await $.clock.now(),
        },
      )
      await $.store.set(record.key, await stampGenerations($, currentProject, decision.state))
    }
    return true
  } catch {
    return false
  }
}

/* Opening this process's attachment to the Run before its first write of
   anything else: the Run's start if it has never appeared, an attach if this
   process is taking it up again. It is only queued here, and persisted before
   anything is attempted; the writer that runs next lands it ahead of whatever
   the attachment was about to record. `forSessionId` names the segment the Run
   is in when that is not the current one — at `classic.SessionEnd` the segment
   is the one that is ending. */
async function ensureRunAttached(
  $: EngineInterface,
  currentProject: ProjectState,
  forSessionId?: string,
): Promise<boolean> {
  const sessionId = forSessionId ?? startup.sessionId
  const host = startup.hostGeneration
  if (!startup.runId || !sessionId || startup.hostStartedAt === undefined || !host) {
    return false
  }
  if (!await detachAbandonedRuns($, currentProject)) return false
  try {
    const state = await loadLifecycle($, currentProject)
    const kind = attachmentOpening(state, host)
    if (!kind) {
      const stayed = stayAttached(state)
      if (stayed !== state) await saveLifecycle($, currentProject, stayed)
      return true
    }
    /* Derived, not drawn: two writers of this process opening the same stretch
       at once name the same attach, and the helper answers it once. */
    const attachmentId = await sha256(
      `prompt-trail:attachment:1:${host}:${state.attachment?.id ?? 'none'}`,
    )
    const decision = attachRun(
      state,
      {
        eventId: await runBoundaryEventId(kind, currentProject.id, startup.runId, attachmentId),
        runId: startup.runId,
        segmentId: sessionId,
        branchId: (await branchState($, currentProject, sessionId)).value.branchId,
        /* A Run's start is dated by the process that began it, the same on every
           replay; an attach by the moment this process took the Run up. */
        occurredAt: kind === 'run-started' ? startup.hostStartedAt : await $.clock.now(),
      },
      { id: attachmentId, host },
    )
    await saveLifecycle($, currentProject, decision.state)
    return decision.note !== 'run-attach-refused'
  } catch {
    return false
  }
}

/* A write owed to a generation since cleared or quarantined: it belongs to
   that history, which is gone, and is dropped rather than carried over. */
function retiredWrite(error: unknown): boolean {
  if (failureCategory(error, 'boundary-append') !== 'archive-generation') return false
  lifecycleFailure = undefined
  return true
}

/* Writing what this Run owes, oldest first, and stopping at the first write
   that does not land so nothing is ordered ahead of a fact it follows. Answers
   whether the Run owes nothing more. */
async function flushOwnLifecycle(
  $: EngineInterface,
  currentProject: ProjectState,
): Promise<boolean> {
  let own: LifecycleState
  try {
    own = await loadLifecycle($, currentProject)
  } catch {
    return false
  }
  let settled = own
  for (const write of own.queue) {
    if (write.generation === UNKNOWN_GENERATION) {
      try {
        settled = oweGap(settled, ['generation-unknown'], await gapFields($, currentProject))
      } catch {
        break
      }
      settled = dequeueLifecycleWrite(settled, write.eventId)
      announceGap($, ['generation-unknown'])
      continue
    }
    try {
      await writeBoundary($, currentProject, write)
    } catch (error) {
      if (!retiredWrite(error)) break
    }
    settled = dequeueLifecycleWrite(settled, write.eventId)
  }
  if (settled === own) return own.queue.length === 0
  try {
    await saveLifecycle($, currentProject, settled)
  } catch {
    /* The boundaries landed and the record still names them. A replay answers
       the stored sequence, but the queue is not provably empty. */
    return false
  }
  return settled.queue.length === 0
}

/* Writing what the project's other Runs still owe, each record oldest first.
   Their facts belong to processes that have already gone, so every write of
   this Run — its start above all — is ordered after them where they can land.
   Answers whether they owe nothing more. */
async function flushForeignLifecycles(
  $: EngineInterface,
  currentProject: ProjectState,
): Promise<boolean> {
  let foreign: { key: string; value: LifecycleState }[]
  try {
    foreign = await foreignLifecycles($, currentProject)
  } catch {
    return false
  }
  let settledAll = true
  let live: string[] | null | undefined
  const liveRuns = async (): Promise<string[] | null> => {
    if (live === undefined) {
      try {
        live = (await readArchiveStatus($, currentProject)).liveRuns
      } catch {
        live = null
      }
    }
    return live
  }
  const prefix = lifecyclePrefix(currentProject.id)
  for (const record of foreign) {
    const runOf = record.key.slice(prefix.length)
    /* Losses another Run has on record and will not record itself: it is
       gone, so they are its gap. A live one records its own. */
    const losses = lossReasons(record.value).filter(reason => !record.value.gap?.reasons.includes(reason))
    if (record.value.queue.length === 0 && !record.value.gap && losses.length === 0) continue
    let settled = record.value
    if (losses.length > 0) {
      const running = await liveRuns()
      if (running !== null && !running.includes(runOf)) {
        try {
          const segmentId = settled.attachment?.segmentId ?? runOf
          settled = oweGap(settled, losses, {
            eventId: await sha256(`prompt-trail:integrity-gap:losses:1:${record.key}:${losses.join(',')}`),
            runId: runOf,
            segmentId,
            branchId: storedBranch(await $.store.get(branchKey(currentProject.id, runOf, segmentId)))?.branchId
              ?? runOf,
            occurredAt: await $.clock.now(),
            generation: null,
          })
        } catch {
          settledAll = false
          continue
        }
      }
    }
    for (const write of record.value.queue) {
      if (write.generation === UNKNOWN_GENERATION) {
        /* Derived from the write, so two Runs finding it at once owe the
           same gap. */
        try {
          settled = oweGap(settled, ['generation-unknown'], {
            eventId: await sha256(`prompt-trail:integrity-gap:generation:1:${write.eventId}`),
            runId: write.runId,
            segmentId: write.segmentId,
            branchId: write.branchId,
            occurredAt: write.occurredAt,
            generation: null,
          })
        } catch {
          break
        }
        settled = dequeueLifecycleWrite(settled, write.eventId)
        continue
      }
      try {
        await writeBoundary($, currentProject, write)
      } catch (error) {
        if (!retiredWrite(error)) break
      }
      settled = dequeueLifecycleWrite(settled, write.eventId)
    }
    /* The gap another Run owes is written for it once what it follows has
       landed. Its recovery says that Run's collection is provable again,
       which only holds once that Run is gone: a live one writes its own. */
    const owed = settled.queue.length === 0 ? settled.gap : undefined
    if (owed) {
      try {
        if (!owed.landed) {
          await writeIntegrity($, currentProject, owed, 'integrity-gap')
          settled = landGap(settled, await $.clock.now())
        }
        const running = await liveRuns()
        const landed = settled.gap
        /* A Run left disabled collects nothing, so nothing is provable again
           until it resumes and writes its own recovery. */
        const disabled = landed
          ? storedRunMode(await $.store.get(runModeKey(currentProject.id, landed.runId)))?.mode === 'disabled'
          : false
        if (landed && running !== null && !running.includes(landed.runId) && !disabled) {
          await writeIntegrity($, currentProject, landed, 'integrity-recovery')
          settled = settleGap(settled)
        }
      } catch (error) {
        if (retiredWrite(error)) settled = settleGap(settled)
        else settledAll = false
      }
    }
    if (settled !== record.value) {
      try {
        await $.store.set(record.key, settled)
      } catch {
        /* The boundaries landed; the record still names them. A replay answers
           the stored sequence, but the queue is not provably empty. */
        settledAll = false
        continue
      }
    }
    if (settled.queue.length > 0 || (settled.gap !== undefined && !settled.gap.landed)) settledAll = false
  }
  return settledAll
}

/* One classic lifecycle event, run through the state machine and then through
   the archive. Nothing here can block the event: `/clear` happens and the
   process exits whether or not the boundary lands, so what cannot be written
   now is left owed and the next composer submission — this Run's or, after an
   exit, another Run's — pays for it.

   The order is deliberate. The write is persisted as owed *before* it is
   attempted, so every crash window is recoverable: die before the append and
   the queue still names it; die after, and the replay is idempotent on the
   derived event id. Attempting first and recording afterwards leaves a window
   where a boundary is neither in the archive nor owed by anyone.

   It reports nothing to the person. A lifecycle event has no reply surface, and
   `/prompt-history status` is where an owed boundary becomes visible. */
async function applyLifecycle(
  $: EngineInterface,
  input: LifecycleEvent,
): Promise<void> {
  /* A `/clear` leaves a marker while it is being recorded; it goes once the
     boundary is owed on record, or stays held with a clear kept in memory.
     A handler that throws leaves it for the next submission to find. */
  const held: { key?: string } = {}
  try {
    await applyLifecycleEvent($, input, held)
  } catch (error) {
    if (held.key) liveCalls.delete(markerCall(held.key))
    throw error
  }
  if (held.key && deferredClear?.marker !== held.key) await releaseMarker($, held.key)
}

async function applyLifecycleEvent(
  $: EngineInterface,
  input: LifecycleEvent,
  held: { key?: string },
): Promise<void> {
  if (!runtimeTarget) return
  const isClearEnd = input.event === 'session-end' && input.reason === 'clear'
  const isResumeEnd = input.event === 'session-end' && input.reason === 'resume'
  const isRunEnd = input.event === 'session-end'
    && input.reason !== 'clear'
    && input.reason !== 'resume'
  /* A `/clear` this Run cannot record at all is remembered in memory so the
     next submission is blocked and every drain retries it. The instant is
     taken now, because a boundary written later must still say when the
     segment actually ended. An exit has no next submission to block: a Run
     end that cannot be recorded leaves the Run unclosed, which is what it is. */
  const defer = async (seenIn?: ProjectState) => {
    if (!isClearEnd || deferredClear) return
    let occurredAt = 0
    try {
      occurredAt = await $.clock.now()
    } catch {
      // Dated as unknown.
    }
    /* Owed to the generation it was seen in, so a clear or quarantine before
       it lands retires it with that history. */
    let generation: string | null = UNKNOWN_GENERATION
    try {
      if (seenIn) generation = (await readArchiveStatus($, seenIn)).generation
    } catch {
      // Left unknown.
    }
    deferredClear = {
      sessionId: input.sessionId,
      occurredAt,
      generation,
      ...(held.key ? { marker: held.key } : {}),
    }
  }

  let currentProject: ProjectState
  try {
    currentProject = await prepareProject($)
  } catch {
    if (project?.consent === 'enabled') await defer()
    return
  }
  /* Before consent there is no archive at all, so there is no segment to cut
     and nothing to owe. */
  if (currentProject.consent !== 'enabled') return
  if (!startup.runId) {
    await defer(currentProject)
    return
  }

  /* A Run whose collection is switched off records nothing between its stop and
     resume boundaries, and a Clear Boundary inside that interval would describe
     the shape of prompts that were never archived. The structural fact still
     survives: resuming starts a new root Conversation Branch of its own. A
     process leaving the Run is not such a shape: a disabled Run it took up is
     still left. */
  if (!isRunEnd && !isResumeEnd) {
    let mode: RunModeState
    try {
      mode = (await loadRunMode($, currentProject)).value
    } catch {
      await defer(currentProject)
      return
    }
    if (mode.mode === 'disabled') return
  }

  if (isClearEnd) {
    const call = crypto.randomUUID()
    try {
      liveCalls.add(call)
      held.key = await writeMarker($, currentProject, call, 'clear-observed', input.sessionId)
    } catch {
      /* Nothing blocks a `/clear`: recorded without a marker, it is only
         lost unseen if the process goes before it is owed. */
      liveCalls.delete(call)
    }
  }

  /* A `/clear` is a write of this Run, so this process's attachment is opened
     ahead of it. Leaving never opens one: a process that archived nothing has
     nothing to leave. */
  if (isClearEnd && !await ensureRunAttached($, currentProject, input.sessionId)) {
    await defer(currentProject)
    return
  }

  let state: LifecycleState
  try {
    state = await loadLifecycle($, currentProject)
  } catch {
    await defer(currentProject)
    return
  }

  let end: { eventId: string; branchId: string; occurredAt: number } | undefined
  if (isClearEnd) {
    try {
      end = {
        eventId: await clearEventId(currentProject.id, input.sessionId),
        /* The branch being cut, read for the session the event names rather
           than for whichever session is current by now. A start writes no
           boundary, so it never asks — and never creates a branch record as a
           side effect. */
        branchId: (await branchState($, currentProject, input.sessionId)).value.branchId,
        occurredAt: deferredClear?.sessionId === input.sessionId
          ? deferredClear.occurredAt
          : await $.clock.now(),
      }
    } catch {
      await defer(currentProject)
      return
    }
  } else if ((isRunEnd || isResumeEnd)
      && state.attachment
      && !state.attachment.closed
      && state.attachment.host === startup.hostGeneration) {
    try {
      end = {
        eventId: await runBoundaryEventId(
          'run-detached',
          currentProject.id,
          startup.runId,
          state.attachment.id,
        ),
        branchId: (await branchState($, currentProject, input.sessionId)).value.branchId,
        occurredAt: await $.clock.now(),
      }
    } catch {
      end = undefined
    }
  }

  const decision = decideLifecycle(state, input, {
    runId: startup.runId,
    ...(startup.hostGeneration ? { host: startup.hostGeneration } : {}),
    ...(end ? { end } : {}),
  })
  if (decision.note === 'clear-deferred') {
    await defer(currentProject)
    return
  }

  if (decision.write) {
    /* Owed first, attempted second. */
    const queued = queueLifecycleWrite(decision.state, decision.write)
    try {
      await saveLifecycle($, currentProject, queued)
    } catch {
      await defer(currentProject)
      return
    }
    if (isClearEnd) {
      /* The clear held earlier is this one, now owed on record; another one
         held is lost, and its marker is left, no longer held, to say so. */
      const earlier = deferredClear
      deferredClear = undefined
      if (earlier?.marker && earlier.sessionId === input.sessionId) await releaseMarker($, earlier.marker)
      else if (earlier?.marker) liveCalls.delete(markerCall(earlier.marker))
    }
    /* A Pending Capture from before the `/clear` or the exit has not taken its
       sequence yet. Appending now would put the boundary ahead of the prompt it
       follows, so the boundary waits in the queue: the drain runs after
       `settlePending()`, which is exactly the right order. */
    if (reconcile) return
    await flushForeignLifecycles($, currentProject)
    if (!await flushOwnLifecycle($, currentProject)) return
    /* A full queue refused this `/clear` and reported the loss. Once everything
       it follows has landed it is still attempted, and only then is it lost. */
    const write = decision.write
    if (!queued.queue.some(owed => owed.eventId === write.eventId)) {
      try {
        await writeBoundary($, currentProject, write)
      } catch {
        // The overflow is already on record for status to report.
      }
    }
    return
  }

  try {
    await saveLifecycle($, currentProject, decision.state)
  } catch {
    /* Nothing was owed, so nothing is lost by failing to record the note. */
  }
}

/* The one place a lifecycle boundary reaches the archive. Both the live
   `/clear` and the recovery queue go through it, so the argument projection,
   the failure category and the timeline row cannot drift apart. */
async function writeBoundary(
  $: EngineInterface,
  currentProject: ProjectState,
  write: LifecycleWrite,
): Promise<void> {
  try {
    const appended = await appendBoundary(
      $,
      currentProject,
      write.branchId,
      write.kind,
      {
        eventId: write.eventId,
        segmentId: write.segmentId,
        occurredAt: write.occurredAt,
        runId: write.runId,
        generation: write.generation,
      },
    )
    recordBoundary($, write.kind, appended, write.runId, write.segmentId)
    lifecycleFailure = undefined
    $.ui.invalidate('ui.render')
  } catch (error) {
    lifecycleFailure = error instanceof Error && SAFE_ERROR_CATEGORIES.has(error.message)
      ? error.message
      : 'boundary-append'
    throw error
  }
}

/* In-flight markers. A composer submission of a collecting Run, and a `/clear`
   being recorded, each leave one in `$.store` while they run — identity only,
   never text — and clear it when they finish. The host lets a prompt through
   when a hook fails or overruns, and a process can go at any point, so one
   that is still there and belongs to no running call is how that is found. */
type InflightStage = 'before-pending' | 'pending' | 'clear-observed'

type InflightMarker = {
  version: 1
  host: string
  stage: InflightStage
  segmentId: string
  branchId: string
  at: number
}

function inflightPrefix(projectId: string): string {
  return `prompt-trail:inflight:${projectId}:`
}

function inflightKey(projectId: string, runId: string, call: string): string {
  return `${inflightPrefix(projectId)}${runId}:${call}`
}

function storedMarker(value: unknown): InflightMarker | undefined {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.host !== 'string' ||
    (value.stage !== 'before-pending' && value.stage !== 'pending' && value.stage !== 'clear-observed') ||
    !isSafeId(value.segmentId) ||
    !isSafeId(value.branchId) ||
    !Number.isSafeInteger(value.at)
  ) return undefined
  return {
    version: 1,
    host: value.host,
    stage: value.stage,
    segmentId: value.segmentId,
    branchId: value.branchId,
    at: value.at as number,
  }
}

async function writeMarker(
  $: EngineInterface,
  currentProject: ProjectState,
  call: string,
  stage: InflightStage,
  segmentId: string,
): Promise<string> {
  if (!startup.runId || !startup.hostGeneration) throw new Error('capture-identity')
  const key = inflightKey(currentProject.id, startup.runId, call)
  const value: InflightMarker = {
    version: 1,
    host: startup.hostGeneration,
    stage,
    segmentId,
    branchId: (await branchState($, currentProject, segmentId)).value.branchId,
    at: await $.clock.now(),
  }
  await $.store.set(key, value)
  return key
}

/* The call a marker key names, which is its last field. */
function markerCall(key: string): string {
  return key.slice(key.lastIndexOf(':') + 1)
}

/* The Run and call a key under the project's marker prefix names; undefined
   for a key that is not one. */
function markerOwner(key: string, projectId: string): { runOf: string; call: string } | undefined {
  const prefix = inflightPrefix(projectId)
  if (!key.startsWith(prefix)) return undefined
  const [runOf, call] = key.slice(prefix.length).split(':')
  return runOf && call ? { runOf, call } : undefined
}

async function removeMarker($: EngineInterface, key: string | undefined): Promise<void> {
  if (!key) return
  try {
    await $.store.delete(key)
  } catch {
    // Found again as stale; the gap it owes is derived from it and lands once.
  }
}

/* A marker this module held and no longer needs. */
async function releaseMarker($: EngineInterface, key: string | undefined): Promise<void> {
  if (!key) return
  await removeMarker($, key)
  liveCalls.delete(markerCall(key))
}

/* What the markers no running call holds say about the project's Runs. A
   stage before any pending was staged is a prompt the host let through with
   no Prompt Entry, and a `/clear` still being recorded is one that went
   unrecorded: both are gaps of the Run that left them. A pending one was
   staged, and is settled by reconciliation. Another Run's marker is only
   judged once no live process holds that Run. */
async function settleInflight($: EngineInterface, currentProject: ProjectState): Promise<void> {
  let live: string[] | null | undefined
  for (const key of await $.store.keys()) {
    const owner = markerOwner(key, currentProject.id)
    if (!owner || liveCalls.has(owner.call)) continue
    const { runOf, call } = owner
    const own = runOf === startup.runId
    if (!own) {
      if (live === undefined) {
        try {
          live = (await readArchiveStatus($, currentProject)).liveRuns
        } catch {
          live = null
        }
      }
      if (live === null || live.includes(runOf)) continue
    }
    const found = storedMarker(await $.store.get(key))
    if (found?.stage === 'pending') {
      pendingDiscovered = false
    } else {
      /* One that cannot be read says a call stopped, and not where. */
      const reason: GapReason = found?.stage === 'clear-observed' ? 'clear-unrecorded' : 'fail-open'
      const fields = {
        eventId: await sha256(`prompt-trail:integrity-gap:inflight:1:${key}`),
        runId: runOf,
        segmentId: found?.segmentId ?? call,
        branchId: found?.branchId ?? call,
        occurredAt: found?.at ?? await $.clock.now(),
        generation: null,
      }
      if (own) {
        const state = await loadLifecycle($, currentProject)
        await saveLifecycle($, currentProject, oweGap(state, [reason], fields))
        announceGap($, [reason])
      } else {
        const foreignKey = lifecycleKey(currentProject.id, runOf)
        const state = storedLifecycle(await $.store.get(foreignKey)) ?? emptyLifecycle()
        await $.store.set(foreignKey, oweGap(state, [reason], fields))
      }
    }
    await $.store.delete(key)
  }
}

/* What each loss is called where the person reads it. */
const GAP_REASON_TEXT: Record<GapReason, string> = {
  'fail-open': '上次提交时 Prompt Trail 出错，那条 prompt 未被记录',
  'clear-unrecorded': '/clear 未能记录',
  'queue-overflow': '恢复队列已溢出，部分 Clear Boundary 或 Run 边界未记录',
  'queue-damaged': '恢复队列有无法重放的记录',
  'clear-unobserved': '观察到无对应 SessionEnd 的 /clear',
  'generation-unknown': '有 Clear Boundary 或 Run 边界无法确定所属的档案，已丢弃',
}

function gapReasonsText(reasons: readonly GapReason[]): string {
  return reasons.map(reason => GAP_REASON_TEXT[reason]).join('；')
}

function announceGap($: EngineInterface, reasons: readonly GapReason[]): void {
  $.ui.toast(`Prompt Trail 无法证明此前的记录与对话一致（${gapReasonsText(reasons)}），已在时间线中标记 Integrity gap。`)
}

/* The fields of a gap found now, in this Run's current segment and branch,
   owed to the generation standing now: one a clear or quarantine retires
   before it lands goes with the history it described. */
async function gapFields(
  $: EngineInterface,
  currentProject: ProjectState,
): Promise<Omit<OwedGap, 'reasons' | 'landed' | 'recoveryAt'>> {
  if (!startup.runId || !startup.sessionId) throw new Error('capture-identity')
  let generation: string | null = null
  try {
    generation = (await readArchiveStatus($, currentProject)).generation
  } catch {
    // Unknown, the gap is written into whichever generation stands.
  }
  return {
    eventId: crypto.randomUUID(),
    runId: startup.runId,
    segmentId: startup.sessionId,
    branchId: (await branchState($, currentProject)).value.branchId,
    occurredAt: await $.clock.now(),
    generation,
  }
}

/* One of the two integrity boundaries of an owed gap. */
async function writeIntegrity(
  $: EngineInterface,
  currentProject: ProjectState,
  owed: OwedGap,
  kind: 'integrity-gap' | 'integrity-recovery',
): Promise<void> {
  const eventId = kind === 'integrity-gap'
    ? owed.eventId
    : await sha256(`prompt-trail:integrity-recovery:1:${owed.eventId}`)
  try {
    const appended = await appendBoundary($, currentProject, owed.branchId, kind, {
      eventId,
      segmentId: owed.segmentId,
      occurredAt: kind === 'integrity-gap' ? owed.occurredAt : owed.recoveryAt ?? owed.occurredAt,
      runId: owed.runId,
      generation: owed.generation,
    })
    recordBoundary($, kind, appended, owed.runId, owed.segmentId)
    lifecycleFailure = undefined
    $.ui.invalidate('ui.render')
  } catch (error) {
    lifecycleFailure = failureCategory(error, 'boundary-append')
    throw error
  }
}

/* Recording what this Run lost, once everything it owes ahead of the loss has
   landed: the Integrity gap first, then — unless the caller has more to write
   before collection is provable again — the recovery boundary that starts a
   new verifiable interval. Answers whether nothing is left owed that must
   land before the next Prompt Entry. */
async function recordIntegrityGap(
  $: EngineInterface,
  currentProject: ProjectState,
  recover: boolean,
): Promise<boolean> {
  let state: LifecycleState
  try {
    state = await loadLifecycle($, currentProject)
    const fresh = lossReasons(state).filter(reason => !state.gap?.reasons.includes(reason))
    if (fresh.length > 0) {
      state = oweGap(state, fresh, await gapFields($, currentProject))
      await saveLifecycle($, currentProject, state)
      announceGap($, fresh)
    }
  } catch {
    return false
  }
  const owed = state.gap
  if (!owed) return true
  try {
    if (!owed.landed) {
      await writeIntegrity($, currentProject, owed, 'integrity-gap')
      state = landGap(state, await $.clock.now())
      await saveLifecycle($, currentProject, state)
    }
    if (!recover) return true
    const landed = state.gap
    if (landed) await writeIntegrity($, currentProject, landed, 'integrity-recovery')
  } catch (error) {
    if (!retiredWrite(error)) return false
    /* Owed to history since cleared or quarantined: it went with it. */
  }
  try {
    await saveLifecycle($, currentProject, settleGap(state))
  } catch {
    return false
  }
  return true
}

/* Emptying the lifecycle recovery queue, which spec §9 requires before the next
   composer submission: a prompt archived ahead of the Clear Boundary that
   precedes it would put the segment break in the wrong place, so a queue that
   will not drain blocks the submission instead.

   It also finishes what a `/clear` could not record at the time, and drains
   what the project's other Runs left behind — a Run that died mid-transition
   cannot come back to pay its own debt. */
async function drainLifecycle(
  $: EngineInterface,
  currentProject: ProjectState,
  recover = true,
): Promise<'clear' | 'blocked'> {
  /* Every caller is about to write for this Run, so its start is owed first. */
  if (!await ensureRunAttached($, currentProject)) return 'blocked'

  /* A `/clear` this Run saw but never managed to write down. Completing it now
     replays the instant it was seen, not the instant of the retry. */
  const owed = deferredClear
  if (owed) {
    try {
      const write: LifecycleWrite = {
        kind: 'clear',
        eventId: await clearEventId(currentProject.id, owed.sessionId),
        runId: startup.runId ?? '',
        segmentId: owed.sessionId,
        branchId: (await branchState($, currentProject, owed.sessionId)).value.branchId,
        occurredAt: owed.occurredAt,
        generation: owed.generation,
      }
      const state = await loadLifecycle($, currentProject)
      await saveLifecycle($, currentProject, queueLifecycleWrite(state, write))
      deferredClear = undefined
    } catch {
      return 'blocked'
    }
    await releaseMarker($, owed.marker)
  }

  /* Another Run's debts first: they are facts of a process that has already
     gone, and this Run's own start is not ordered ahead of them. */
  const foreignSettled = await flushForeignLifecycles($, currentProject)
  const ownSettled = await flushOwnLifecycle($, currentProject)
  if (!foreignSettled || !ownSettled) return 'blocked'
  return await recordIntegrityGap($, currentProject, recover) ? 'clear' : 'blocked'
}

/* Why a collecting Run is holding a submission: the failure as `status`
   reports it, and what went wrong in words. */
type Blocked = Unavailable & { reason: string }

type Recheck = { result: 'damaged' | 'unreadable'; problems: number }

function storedRecheck(value: unknown): Recheck | undefined {
  return isRecord(value)
    && (value.result === 'damaged' || value.result === 'unreadable')
    && Number.isSafeInteger(value.problems)
    ? { result: value.result, problems: value.problems as number }
    : undefined
}

function recheckNote(recheck: Recheck): string {
  return recheck.result === 'unreadable'
    ? '完整性检查未通过（档案已无法作为数据库读取）'
    : `完整性检查未通过（${recheck.problems} 个问题）`
}

type ArchiveStatus = {
  generation: string | null
  quarantineUnderway: boolean
  clearUnderway: boolean
  /* What an unfinished clear has still to remove, when it could be listed. */
  clearResidual?: number
  clearRunUnderway: boolean
  clearRunResidual?: number
  quarantined: { name: string; path: string; bytes: number }[]
  /* How many Integrity gaps the archive holds; null when it cannot say. */
  integrityGaps: number | null
  /* The Runs other live processes hold; null when that cannot be read. */
  liveRuns: string[] | null
}

type SubmitOutcome = { done: PromptSubmitResult } | { blocked: Blocked }

/* The archive this Run was writing to was replaced by a quarantine, this
   Run's or another's, so what the Run knew of it names events that are not
   there. It starts over in the generation now in place: an attach saying
   where it took that generation up, a new root branch no transcript may
   overrule, and nothing owed to the archive it left, whose pending went
   with it into quarantine. */
async function enterNewGeneration(
  $: EngineInterface,
  currentProject: ProjectState,
  left: string,
): Promise<{ key: string; value: BranchState }> {
  if (!startup.runId || !startup.sessionId) throw new Error('capture-identity')
  const key = branchKey(currentProject.id, startup.runId, startup.sessionId)
  /* Derived from the session and the generation it left, so a retry writes
     the same attach on the same branch, and another session of the Run
     leaving that generation writes its own. */
  const derived = `${currentProject.id}:${startup.runId}:${startup.sessionId}:${left}`
  const root: BranchState = {
    version: 1,
    branchId: await sha256(`prompt-trail:generation-root:1:${derived}`),
    parentEventId: null,
    explicitRoot: true,
  }
  let attached: { eventId: string; sequence: number } | undefined
  try {
    attached = await appendBoundary($, currentProject, root.branchId, 'run-attached', {
      eventId: await sha256(`prompt-trail:run-attached:generation:1:${derived}`),
    })
  } catch (error) {
    /* Written by an earlier try, at another moment: the attach is there. */
    if (failureCategory(error, 'boundary-append') !== 'boundary-conflict') throw error
  }
  await $.store.set(key, root)
  rememberBranch(key, root)
  await clearReconcile($, currentProject)
  resetWindow()
  timelineLoaded = undefined
  if (attached) recordBoundary($, 'run-attached', attached)
  $.ui.invalidate('ui.render')
  return { key, value: root }
}

/* The retry a damaged archive offers: a full check on a connection that only
   reads. Only an archive found sound lifts the report. */
async function recheckArchive(
  $: EngineInterface,
  currentProject: ProjectState,
): Promise<{ result: string; problems: number; generation: string | null }> {
  if (!startup.helperPath || !startup.databaseRoot) throw new Error('capture-identity')
  const result = await runArchive(
    $,
    [
      startup.helperPath,
      'integrity-check',
      startup.databaseRoot,
      currentProject.id,
      EXPECTED_HELPER_SHA256,
      String(HELPER_PROTOCOL),
    ],
    10_000,
  )
  if (result.exitCode !== 0) throw new Error(safeCategory(result.stderr, 'integrity-check'))
  const value: unknown = JSON.parse(result.stdout)
  if (
    !isRecord(value) ||
    value.projectId !== currentProject.id ||
    !['ok', 'damaged', 'unreadable', 'absent'].includes(value.result as string) ||
    !Number.isSafeInteger(value.problems)
  ) throw new Error('integrity-check')
  return {
    result: value.result as string,
    problems: value.problems as number,
    generation: nullableGeneration(value.generation, 'integrity-check'),
  }
}

/* Moves the damaged generation aside unchanged and starts an empty one. The
   helper moves only the generation named; one another Run has replaced
   already answers with the generation now in place. */
async function quarantineArchive(
  $: EngineInterface,
  currentProject: ProjectState,
  damaged: string,
): Promise<{ generation: string; moved: string | null }> {
  if (!startup.helperPath || !startup.databaseRoot || !startup.runId || !startup.sessionId) {
    throw new Error('capture-identity')
  }
  const branch = await branchState($, currentProject)
  const result = await runArchive(
    $,
    [
      startup.helperPath,
      'quarantine',
      startup.databaseRoot,
      currentProject.id,
      damaged,
      startup.runId,
      startup.sessionId,
      branch.value.branchId,
      crypto.randomUUID(),
      String(await $.clock.now()),
      EXPECTED_HELPER_SHA256,
      String(HELPER_PROTOCOL),
    ],
    10_000,
  )
  if (result.exitCode !== 0) throw new Error(safeCategory(result.stderr, 'quarantine'))
  const value: unknown = JSON.parse(result.stdout)
  if (
    !isRecord(value) ||
    value.projectId !== currentProject.id ||
    !isSafeId(value.generation) ||
    (value.moved !== null && !isSafeId(value.moved))
  ) throw new Error('quarantine')
  return { generation: value.generation, moved: value.moved as string | null }
}

/* What `status` shows of the archive without opening it. */
async function readArchiveStatus(
  $: EngineInterface,
  currentProject: ProjectState,
): Promise<ArchiveStatus> {
  if (!startup.helperPath || !startup.databaseRoot) throw new Error('capture-identity')
  const result = await runArchive(
    $,
    [
      startup.helperPath,
      'archive-status',
      startup.databaseRoot,
      currentProject.id,
      EXPECTED_HELPER_SHA256,
      String(HELPER_PROTOCOL),
    ],
    10_000,
  )
  if (result.exitCode !== 0) throw new Error(safeCategory(result.stderr, 'archive-status'))
  const value: unknown = JSON.parse(result.stdout)
  if (
    !isRecord(value) ||
    value.projectId !== currentProject.id ||
    typeof value.quarantineUnderway !== 'boolean' ||
    !Array.isArray(value.quarantined)
  ) throw new Error('archive-status')
  return {
    generation: nullableGeneration(value.generation, 'archive-status'),
    quarantineUnderway: value.quarantineUnderway,
    clearUnderway: value.clearUnderway === true,
    clearRunUnderway: value.clearRunUnderway === true,
    integrityGaps: Number.isSafeInteger(value.integrityGaps) && (value.integrityGaps as number) >= 0
      ? value.integrityGaps as number
      : null,
    liveRuns: Array.isArray(value.liveRuns) && value.liveRuns.every(isSafeId)
      ? value.liveRuns as string[]
      : null,
    quarantined: value.quarantined.map((kept: unknown) => {
      if (
        !isRecord(kept) ||
        !isSafeId(kept.name) ||
        typeof kept.path !== 'string' ||
        !Number.isSafeInteger(kept.bytes)
      ) throw new Error('archive-status')
      return { name: kept.name, path: kept.path, bytes: kept.bytes as number }
    }),
  }
}

/* What the submission met, recorded for this Run (and, for a failure of the
   archive itself, for the project's other Runs). */
async function holdSubmission(
  $: EngineInterface,
  currentProject: ProjectState | undefined,
  category: string,
  reason: string,
  scope?: 'run',
): Promise<SubmitOutcome> {
  return { blocked: { ...await markUnavailable($, currentProject, category, scope), reason } }
}

/* The dialog a held submission waits on. It offers only what spec §13 allows:
   try again, or stop collecting this Run and let the prompt through; a
   damaged archive is never retried by writing to it, but checked again or
   quarantined. Closing it keeps the submission held. */
async function askUnavailable(
  $: EngineInterface,
  failure: Blocked,
): Promise<'retry' | 'recheck' | 'quarantine' | 'clear' | 'continue-clear' | 'disable' | undefined> {
  const scope = failure.scope === 'archive' ? '本项目所有 Run' : '本 Run（其他 Run 不受影响）'
  const damaged = DAMAGE_FAILURES.has(failure.category)
  const clearingRun = failure.category === 'clear-run-unfinished'
  const clearing = failure.category === 'clear-unfinished' || clearingRun
  const choices = damaged
    ? ['重新检查完整性', '隔离并开始新档案', '清除全部档案', '禁用当前 Run 后继续']
    : clearing
      ? ['继续清除', '禁用当前 Run 后继续']
      : ['重试', '禁用当前 Run 后继续']
  /* What an unfinished clear still has to remove, as far as it can be
     listed; the dialog says so either way. */
  let leftovers: string[] = []
  if (clearing) {
    try {
      const inventory = await readClearInventory($, await prepareProject($))
      leftovers = clearingRun ? runLeftovers(inventory) : clearLeftovers(inventory)
    } catch {
      leftovers = ['（无法列出残留）']
    }
  }
  let answer: string | undefined
  try {
    answer = await $.ui.ask(
      [
        `Prompt Trail ${failure.reason}，无法证明这次提交能被正确保存；本次提交尚未进入会话。`,
        `范围：${scope}`,
        `类别：${failure.category}${failure.elsewhere ? '（由另一个 Run 报告）' : ''}`,
        ...(failure.recheck ? [recheckNote(failure.recheck)] : []),
        ...(clearingRun
          ? ['之前确认过的一次按 Run 清除已删除记录，但物理清除未完成，以下残留还在：', ...leftovers.map(line => `- ${line}`)]
          : clearing
            ? ['本项目的清除已切断旧记录，但以下文件还未删除：', ...leftovers.map(line => `- ${line}`)]
            : []),
        damaged
          ? '“重新检查完整性”只读检查档案，通过后提交；“隔离并开始新档案”把旧记录原样保留在隔离目录，新时间线从空开始，之后提交；“清除全部档案”在输入确认短语后永久删除本项目的全部档案，之后提交；“禁用当前 Run 后继续”停止本 Run 的采集后提交，停用期间的 prompt 不会入档。Prompt Trail 不会修复或覆盖损坏的档案。'
          : clearingRun
            ? '“继续清除”完成那次按 Run 清除，之后提交；“禁用当前 Run 后继续”停止本 Run 的采集后提交，停用期间的 prompt 不会入档。'
            : clearing
            ? '“继续清除”删除剩下的文件，完成后提交；“禁用当前 Run 后继续”停止本 Run 的采集后提交，停用期间的 prompt 不会入档。'
            : '“重试”重新检查，成功后提交；“禁用当前 Run 后继续”停止本 Run 的采集后提交，停用期间的 prompt 不会入档。',
      ].join('\n'),
      { header: '档案不可用', options: choices },
    )
  } catch {
    return undefined
  }
  if (answer === '重试') return 'retry'
  if (answer === '重新检查完整性') return 'recheck'
  if (answer === '隔离并开始新档案') return 'quarantine'
  if (answer === '清除全部档案') return 'clear'
  if (answer === '继续清除') return 'continue-clear'
  return answer === '禁用当前 Run 后继续' ? 'disable' : undefined
}

/* A clear chosen while a submission is held: the confirmation first, unless
   a clear already under way is only being finished. Answers whether the
   submission may be tried again in the empty timeline. */
async function answerClear(
  $: EngineInterface,
  choice: 'clear' | 'continue-clear',
  failure: Blocked,
): Promise<boolean> {
  if (failure.category === 'clear-run-unfinished') return continueRunClear($, failure)
  let currentProject: ProjectState
  let onlyContinue = choice === 'continue-clear'
  try {
    currentProject = await prepareProject($)
    if (choice === 'clear') {
      const inventory = await readClearInventory($, currentProject)
      if (inventory.present && await askClear($, currentProject, inventory) !== 'clear') return false
      onlyContinue = inventory.clearUnderway
    }
  } catch {
    return false
  }
  try {
    const cleared = await clearTimeline($, currentProject, onlyContinue)
    if (cleared.cleared) {
      $.ui.toast('Prompt Trail 已清除本项目的全部档案，新时间线从这次提交开始。')
    } else {
      /* Another Run finished it: the archive is usable again. */
      await archiveRecovered($, currentProject)
    }
    return true
  } catch (error) {
    Object.assign(failure, await markUnavailable($, currentProject, failureCategory(error, 'clear-all')))
    return false
  }
}

/* The person's answer to damage, before the submission is tried again.
   Answers whether it may be: a recheck that found the archive sound, or a
   quarantine that put an empty generation in place. Otherwise the failure
   says what was found and the dialog asks again. */
async function answerDamage(
  $: EngineInterface,
  choice: 'recheck' | 'quarantine',
  failure: Blocked,
): Promise<boolean> {
  let currentProject: ProjectState
  try {
    currentProject = await prepareProject($)
  } catch {
    return false
  }
  try {
    if (choice === 'recheck') {
      const found = await recheckArchive($, currentProject)
      if (found.result === 'ok' || found.result === 'absent') {
        await archiveRecovered($, currentProject)
        return true
      }
      /* What was checked is what a quarantine now moves: another Run may
         have replaced the generation this failure first named. */
      damagedGeneration = found.generation ?? undefined
      if (archiveFailure) {
        archiveFailure.recheck = {
          result: found.result === 'unreadable' ? 'unreadable' : 'damaged',
          problems: found.problems,
        }
      }
      Object.assign(failure, await markUnavailable($, currentProject, 'archive-integrity'))
      return false
    }
    let damaged = failure.generation ?? damagedGeneration
    if (!damaged && (await readArchiveStatus($, currentProject)).quarantineUnderway) {
      /* A quarantine already begun is finished whatever generation is named,
         and nothing may be checked until it is. */
      damaged = 'unfinished'
    }
    if (!damaged) {
      /* Nothing named the damaged generation; only one found damaged now
         may be moved. */
      const found = await recheckArchive($, currentProject)
      if (found.result === 'ok' || found.result === 'absent' || !found.generation) {
        await archiveRecovered($, currentProject)
        return true
      }
      damaged = found.generation
    }
    const moved = await quarantineArchive($, currentProject, damaged)
    await archiveRecovered($, currentProject)
    damagedGeneration = undefined
    await enterNewGeneration($, currentProject, damaged)
    try {
      const branch = await branchState($, currentProject)
      const next = { ...branch.value, generation: moved.generation }
      await $.store.set(branch.key, next)
      rememberBranch(branch.key, next)
    } catch {
      // The next capture names no generation and learns it.
    }
    if (moved.moved) $.ui.toast('Prompt Trail 已把损坏的档案原样隔离，新时间线从空开始；/prompt-history status 可查看隔离位置。')
    return true
  } catch (error) {
    const category = failureCategory(error, choice === 'recheck' ? 'integrity-check' : 'quarantine')
    Object.assign(failure, await markUnavailable($, currentProject, category))
    return false
  }
}

/* Clearing the Project Timeline (Issue 30). The helper cuts under the
   project's lock and removes every file the project archived; what a writer
   of the cleared generation still owes is refused there. The person sees the
   scope and types a fixed phrase before anything goes. */
const CLEAR_PHRASE = 'delete all prompts'

type ClearInventory = {
  present: boolean
  clearUnderway: boolean
  clearRunUnderway: boolean
  /* What a Run clear of the Run asked about would remove; absent when no
     Run was named, null when the archive could not say. */
  run?: RunInventory | null
  entries: number | null
  pending: number | null
  otherLiveRuns: number | null
  files: { name: string; bytes: number }[]
  quarantined: { name: string; path: string; bytes: number }[]
}

function nullableCount(value: unknown): number | null {
  if (value === null) return null
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error('clear-inventory')
  return value as number
}

async function readClearInventory(
  $: EngineInterface,
  currentProject: ProjectState,
  forRun?: string,
): Promise<ClearInventory> {
  if (!startup.helperPath || !startup.databaseRoot) throw new Error('capture-identity')
  const result = await runArchive(
    $,
    [
      startup.helperPath,
      'clear-inventory',
      startup.databaseRoot,
      currentProject.id,
      EXPECTED_HELPER_SHA256,
      String(HELPER_PROTOCOL),
      ...(forRun ? [forRun] : []),
    ],
    10_000,
  )
  if (result.exitCode !== 0) throw new Error(safeCategory(result.stderr, 'clear-inventory'))
  const value: unknown = JSON.parse(result.stdout)
  if (
    !isRecord(value) ||
    value.projectId !== currentProject.id ||
    typeof value.present !== 'boolean' ||
    typeof value.clearUnderway !== 'boolean' ||
    !Array.isArray(value.files) ||
    !Array.isArray(value.quarantined)
  ) throw new Error('clear-inventory')
  return {
    present: value.present,
    clearUnderway: value.clearUnderway,
    clearRunUnderway: value.clearRunUnderway === true,
    ...(forRun ? { run: runInventory(value.run) } : {}),
    entries: nullableCount(value.entries),
    pending: nullableCount(value.pending),
    otherLiveRuns: nullableCount(value.otherLiveRuns),
    files: value.files.map((file: unknown) => {
      if (!isRecord(file) || typeof file.name !== 'string' || !Number.isSafeInteger(file.bytes)) {
        throw new Error('clear-inventory')
      }
      return { name: file.name, bytes: file.bytes as number }
    }),
    quarantined: value.quarantined.map((kept: unknown) => {
      if (
        !isRecord(kept) ||
        !isSafeId(kept.name) ||
        typeof kept.path !== 'string' ||
        !Number.isSafeInteger(kept.bytes)
      ) throw new Error('clear-inventory')
      return { name: kept.name, path: kept.path, bytes: kept.bytes as number }
    }),
  }
}

/* Every file the clear still has to remove, by its full path. */
function clearLeftovers(inventory: ClearInventory): string[] {
  return [
    ...inventory.files.map(file => `${startup.databaseRoot ?? ''}/${file.name}（${file.bytes} 字节）`),
    ...inventory.quarantined.map(kept => `${kept.path}（隔离档案，${kept.bytes} 字节）`),
  ]
}

const CLEAR_BOUNDARY = 'Prompt Trail 的删除不会删除 Claude Code 的 transcript/history、文件系统快照或第三方备份中的副本，也不保证 SSD 上的数据在物理上不可恢复。'

/* The person's answer to a clear: the fixed phrase typed in full, a clear
   already under way taken up, or anything else, which removes nothing. */
async function askClear(
  $: EngineInterface,
  currentProject: ProjectState,
  inventory: ClearInventory,
): Promise<'clear' | 'cancelled' | 'mistyped'> {
  let answer: string | undefined
  try {
    if (inventory.clearUnderway) {
      answer = await $.ui.ask(
        [
          '上一次清除尚未完成：切点已生效，旧记录不会再被读写，但以下文件还未删除：',
          ...clearLeftovers(inventory).map(line => `- ${line}`),
          '清除完成前，本项目的档案不可用。',
        ].join('\n'),
        { header: '继续清除', options: ['继续清除', '取消'] },
      )
      return answer === '继续清除' ? 'clear' : 'cancelled'
    }
    const counts = inventory.entries === null
      ? '活动档案已损坏，无法读取条数'
      : `活动档案：${inventory.entries} 条 Prompt Entry、${pendingCount(inventory.pending)}`
    const others = inventory.otherLiveRuns === null
      ? '无法确定是否还有其他正在运行的 Run 使用本项目；若有，它们在下次读取前仍可能显示旧内容。'
      : inventory.otherLiveRuns > 0
        ? `另有 ${inventory.otherLiveRuns} 个正在运行的 Run 使用本项目；它们会在新的时间线中继续，但在下次读取前仍可能显示旧内容。`
        : undefined
    answer = await $.ui.ask(
      [
        'Prompt Trail 将永久删除这个 Project Timeline 的全部档案。',
        `项目：${currentProject.root}`,
        counts,
        ...inventory.files.map(file => `文件：${file.name}（${file.bytes} 字节）`),
        ...inventory.quarantined.map(kept => `隔离档案：${kept.name}（${kept.bytes} 字节）`),
        ...(others ? [others] : []),
        '正在提交中的 prompt 也会被清除。Collection consent 与当前 Run 的采集模式不变。',
        CLEAR_BOUNDARY,
        `确认删除请选对话框的自由输入项，输入：${CLEAR_PHRASE}`,
      ].join('\n'),
      { header: '清除档案', options: ['取消', '返回'] },
    )
  } catch {
    return 'cancelled'
  }
  if (answer === undefined || answer === '取消' || answer === '返回') return 'cancelled'
  return answer.trim() === CLEAR_PHRASE ? 'clear' : 'mistyped'
}

/* The Runs the store knows in this project, whose session index records go
   with the archive unless they go on. */
async function projectRuns($: EngineInterface, currentProject: ProjectState): Promise<string[]> {
  const runs = new Set<string>(startup.runId ? [startup.runId] : [])
  for (const key of await $.store.keys()) {
    for (const kind of ['branch', 'run-mode', 'lifecycle']) {
      const head = `prompt-trail:${kind}:${currentProject.id}:`
      const owner = key.startsWith(head) ? key.slice(head.length).split(':')[0] : undefined
      if (isSafeId(owner)) runs.add(owner)
    }
  }
  return [...runs]
}

type Cleared = {
  /* False when only continuing, and the clear had finished elsewhere. */
  cleared: boolean
  entries: number | null
  pending: number | null
  quarantined: number
  sessionsFailed: number
  /* Whether the store forgot everything it kept of the cleared history. */
  forgotten: boolean
}

/* What the store kept about the cleared history goes with it: the pending
   owed, the failure on record, every lifecycle write still owed and the
   Collection Boundary each Run last wrote. Consent, each Run's collection
   mode and its branch stay; a branch names the generation it was in, so the
   next capture starts over in the new one. */
async function forgetClearedHistory($: EngineInterface, currentProject: ProjectState): Promise<boolean> {
  await clearReconcile($, currentProject)
  await archiveRecovered($, currentProject)
  damagedGeneration = undefined
  archiveStatus = undefined
  /* A `/clear` this Run saw and never recorded belongs to the cleared
     history too. */
  await releaseMarker($, deferredClear?.marker)
  deferredClear = undefined
  if (runMode) runMode = { ...runMode, value: { version: 1, mode: runMode.value.mode } }
  let forgotten = true
  try {
    for (const key of await $.store.keys()) {
      if (key.startsWith(lifecyclePrefix(currentProject.id))) {
        await forgetOwedLifecycle($, key)
      } else if (key.startsWith(`prompt-trail:run-mode:${currentProject.id}:`)) {
        await forgetCollectionBoundary($, key)
      }
    }
    /* A Run live elsewhere may still be submitting: its marker stays with it.
       Not knowing which are live, only this Run's are taken. */
    let live: string[] | null = null
    try {
      live = (await readArchiveStatus($, currentProject)).liveRuns
    } catch {
      // Unknown.
    }
    await forgetMarkers($, currentProject, runOf =>
      runOf === startup.runId || (live !== null && !live.includes(runOf)))
  } catch {
    forgotten = false
  }
  lifecycleFailure = undefined
  resetWindow()
  timelineLoaded = undefined
  $.ui.invalidate('ui.render')
  return forgotten
}

/* A Run's lifecycle writes still owed to cleared history, and the gap it owed
   with the losses it recorded: what they described is gone. */
async function forgetOwedLifecycle($: EngineInterface, key: string): Promise<void> {
  const value = storedLifecycle(await $.store.get(key))
  if (value && (value.queue.length > 0 || value.gap || lossReasons(value).length > 0)) {
    await $.store.set(key, withoutOwed(value))
  }
}

function withoutOwed(value: LifecycleState): LifecycleState {
  const { gap: _gap, overflowed: _overflowed, damaged: _damaged, unobservedClear: _unobserved, ...kept } = value
  return { ...kept, queue: [] }
}

/* The in-flight markers of cleared history: every one no running call of
   this module holds, of the Runs `forRun` accepts. */
async function forgetMarkers(
  $: EngineInterface,
  currentProject: ProjectState,
  forRun: (runId: string) => boolean,
): Promise<void> {
  for (const key of await $.store.keys()) {
    const owner = markerOwner(key, currentProject.id)
    if (!owner || liveCalls.has(owner.call) || !forRun(owner.runOf)) continue
    await $.store.delete(key)
  }
}

/* The Collection Boundary a Run last wrote into cleared history; its mode stays. */
async function forgetCollectionBoundary($: EngineInterface, key: string): Promise<void> {
  const value = storedRunMode(await $.store.get(key))
  if (value && (value.boundary || value.stopBoundaryMissing)) {
    await $.store.set(key, { version: 1, mode: value.mode })
  }
}

/* Runs the clear the person confirmed. Answers what it removed, or the
   category it stopped at. */
async function clearTimeline(
  $: EngineInterface,
  currentProject: ProjectState,
  onlyContinue = false,
): Promise<Cleared> {
  if (!startup.helperPath || !startup.databaseRoot || !startup.runId) {
    throw new Error('capture-identity')
  }
  const runs = await projectRuns($, currentProject)
  let result: Awaited<ReturnType<typeof runArchive>>
  try {
    result = await runArchive(
      $,
      [
        startup.helperPath,
        'clear-all',
        startup.databaseRoot,
        currentProject.id,
        startup.runId,
        EXPECTED_HELPER_SHA256,
        String(HELPER_PROTOCOL),
        '--stdin',
        ...(onlyContinue ? ['--continue'] : []),
      ],
      30_000,
      runs.map(owner => `${owner}\n`).join(''),
    )
    if (result.exitCode !== 0) throw new Error(safeCategory(result.stderr, 'clear-all'))
  } catch (error) {
    /* A clear stopped past its cut, whatever stopped it, is unfinished:
       the archive stays unavailable and nothing may call it undone. */
    if (failureCategory(error, 'clear-all') !== 'clear-unfinished') {
      let underway = false
      try {
        underway = (await readClearInventory($, currentProject)).clearUnderway
      } catch {
        // Not known to be under way; the failure stands as it came.
      }
      if (underway) throw new Error('clear-unfinished')
    }
    throw error
  }
  const value: unknown = JSON.parse(result.stdout)
  if (
    !isRecord(value) ||
    value.projectId !== currentProject.id ||
    typeof value.cleared !== 'boolean' ||
    !Number.isSafeInteger(value.quarantined) ||
    !Number.isSafeInteger(value.sessionsFailed)
  ) throw new Error('clear-all')
  const forgotten = value.cleared ? await forgetClearedHistory($, currentProject) : true
  return {
    cleared: value.cleared,
    entries: nullableCount(value.entries),
    pending: nullableCount(value.pending),
    quarantined: value.quarantined as number,
    sessionsFailed: value.sessionsFailed as number,
    forgotten,
  }
}

function pendingCount(pending: number | null): string {
  return pending === null ? 'Pending Capture 数量无法读取' : `${pending} 个 Pending Capture`
}

function clearedText(cleared: Cleared): string {
  const counts = cleared.entries === null
    ? '损坏的活动档案（条数无法读取）'
    : `${cleared.entries} 条 Prompt Entry、${pendingCount(cleared.pending)}`
  return [
    `已清除本项目的 Prompt Trail 档案：${counts}、${cleared.quarantined} 个隔离档案。`,
    'Collection consent 与当前 Run 的采集模式未改变；新时间线从下一次提交开始。',
    ...(cleared.sessionsFailed > 0
      ? [`有 ${cleared.sessionsFailed} 条会话索引记录未能删除；恢复这些会话时可能接回旧 Run。`]
      : []),
    ...(cleared.forgotten
      ? []
      : ['部分 Prompt Trail 状态未能清理（不含 prompt 原文）；status 可能仍显示旧的 Collection Boundary 或待写边界。']),
    CLEAR_BOUNDARY,
  ].join('\n')
}

/* A clear that cut but left files behind: the archive stays unavailable
   until one finishes, and the person sees exactly what is left. */
async function unfinishedClearText($: EngineInterface, currentProject: ProjectState): Promise<string> {
  let leftovers: string[] = []
  try {
    leftovers = clearLeftovers(await readClearInventory($, currentProject))
  } catch {
    // The listing is best effort; the state it describes is on record.
  }
  return [
    '切点已生效，旧记录不会再被读写；但以下残留未能删除：',
    ...(leftovers.length > 0 ? leftovers.map(line => `- ${line}`) : ['- （无法列出残留）']),
    '清除完成前，本项目的档案不可用；可再次执行 /prompt-history clear-all 继续。',
  ].join('\n')
}

async function clearAllCommand($: EngineInterface): Promise<string> {
  if (!runtimeTarget) return 'Prompt Trail 尚未确定运行目标，无法清除档案。'
  await refreshStartup($)
  if (startup.support !== 'supported') {
    return `Prompt Trail 在当前环境不可用（${startup.support}：${startup.reason}），未清除任何内容。`
  }
  let currentProject: ProjectState
  let inventory: ClearInventory
  try {
    currentProject = await prepareProject($)
    inventory = await readClearInventory($, currentProject)
  } catch (error) {
    return `Prompt Trail 无法列出本项目的档案（${failureCategory(error, 'clear-inventory')}），未清除任何内容。`
  }
  if (!inventory.present) return '没有可清除的 Prompt Trail 档案。'
  const answer = await askClear($, currentProject, inventory)
  if (answer === 'cancelled') return '已取消，未删除任何内容。'
  if (answer === 'mistyped') return '确认短语不符，未删除任何内容。'
  try {
    const cleared = await clearTimeline($, currentProject, inventory.clearUnderway)
    if (!cleared.cleared && inventory.clearUnderway) {
      await archiveRecovered($, currentProject)
      return '上一次清除已由其他 Run 完成，未删除任何新记录。'
    }
    return clearedText(cleared)
  } catch (error) {
    const category = failureCategory(error, 'clear-all')
    if (category !== 'clear-unfinished') {
      return `Prompt Trail 未能开始清除（${category}），未删除任何内容。`
    }
    await markUnavailable($, currentProject, category)
    return unfinishedClearText($, currentProject)
  }
}

/* Once the low-space warning has been shown to a Run: it spans the Run's
   processes, so a reload or a resume does not show it again. */
function spaceWarnedKey(projectId: string, forRunId: string): string {
  return `prompt-trail:space-warned:${projectId}:${forRunId}`
}

async function noteDiskSpace(
  $: EngineInterface,
  currentProject: ProjectState,
  lowSpace: boolean | undefined,
): Promise<void> {
  diskSpace = lowSpace === undefined ? 'unknown' : lowSpace ? 'low' : 'ok'
  if (!lowSpace || !startup.runId) return
  const key = spaceWarnedKey(currentProject.id, startup.runId)
  /* A store that cannot say whether the Run was warned leaves this module
     instance to remember it: the warning is not skipped for want of it. */
  if (spaceWarned.has(key)) return
  spaceWarned.add(key)
  try {
    if (await $.store.get(key) !== undefined) return
    await $.store.set(key, { version: 1 })
  } catch {
    // Warned below all the same; a reload may warn this Run once more.
  }
  $.ui.toast(`Prompt Trail 档案所在磁盘可用空间低于 1 GiB：${statusValue(currentProject.databasePath ?? '')}`)
}

/* One attempt at a collecting submission. `retrying` is the person's own
   retry, which tries the archive even though a failure is on record. */
async function submitCollected(
  $: EngineInterface,
  e: PromptSubmitInput,
  next: (e: PromptSubmitInput) => Promise<PromptSubmitResult>,
  retrying: boolean,
  call: string,
  markers: Map<string, string>,
): Promise<SubmitOutcome> {
  if (!runtimeTarget) return { done: await next(e) }
  let currentProject: ProjectState
  try {
    currentProject = await prepareProject($)
  } catch {
    /* A Run that is already known to be disabled collects nothing, so there
       is nothing to miss and nothing to block. */
    if (runMode?.value.mode === 'disabled') return { done: await next(e) }
    if (project?.consent === 'enabled') {
      return holdSubmission($, undefined, 'project-root-unproven', '无法证明当前项目身份')
    }
    return { done: await next(e) }
  }
  /* An in-process `/resume` may have moved this process to another Run. The
     switch that decides this submission is that Run's, so the locator is
     read again before it, never after. */
  try {
    if ((await $.session.id()) !== startup.sessionId) await refreshStartup($)
  } catch {
    // The switch is read below for the Run last proven; the target is re-checked after.
  }
  /* A disabled Run lets the submission through untouched: no Pending Capture,
     no Prompt Entry, and no archive block standing in its way. */
  let mode: RunModeState
  try {
    mode = (await loadRunMode($, currentProject)).value
  } catch {
    if (currentProject.consent === 'enabled') {
      return holdSubmission($, currentProject, 'run-mode-unreadable', '无法读取当前 Run collection mode')
    }
    return { done: await next(e) }
  }
  if (mode.mode === 'disabled') return { done: await next(e) }

  try {
    startup = await inspectTarget(
      $,
      runtimeTarget.isInteractive,
      runtimeTarget.surface,
      runtimeTarget.cwd,
    )
  } catch {
    if (currentProject.consent === 'enabled') {
      return holdSubmission($, currentProject, 'preflight-failed', 'preflight 失败')
    }
    return { done: await next(e) }
  }
  forgetOtherRunsFailure()
  if (startup.support !== 'supported') {
    if (currentProject.consent === 'enabled') {
      /* Whatever the target lacks is this process's, never the archive's, and
         is named by the reason status reports for it. */
      return holdSubmission($, undefined, statusValue(startup.reason), '当前不可采集', 'run')
    }
    return { done: await next(e) }
  }
  if (!startup.databaseRoot) {
    if (currentProject.consent === 'enabled') {
      return holdSubmission($, currentProject, 'database-root-unproven', '无法证明数据库位置')
    }
    return { done: { drop: 'Prompt Trail 无法证明数据库位置；本次提交未进入会话。' } }
  }
  currentProject.databasePath = `${startup.databaseRoot}/${currentProject.id}.sqlite3`
  startup.projectPath = currentProject.root

  let decision: ConsentDecision | undefined
  try {
    decision = await requestConsent($, currentProject)
  } catch {
    return { done: { drop: 'Prompt Trail 无法完成采集同意；本次提交未进入会话。' } }
  }
  if (decision === 'declined') return { done: await next(e) }
  if (decision !== 'enabled') {
    return { done: { drop: '请选择“启用”或“继续但不启用”后再提交。' } }
  }

  /* What an earlier call left unfinished is judged before this one leaves
     its own marker, and before any pending is listed: a call that died after
     staging makes this Run list its pendings again. */
  try {
    await settleInflight($, currentProject)
  } catch {
    return holdSubmission($, currentProject, 'inflight-unreadable', '无法确认上一次提交是否完整')
  }
  if (!markers.has(call)) {
    try {
      markers.set(call, await writeMarker($, currentProject, call, 'before-pending', startup.sessionId ?? call))
    } catch {
      return holdSubmission($, currentProject, 'inflight-unrecorded', '无法记录在途的提交')
    }
  }

  /* Anything unresolved is settled before another capture is staged, so a
     second pending can never pile onto the first. This runs ahead of the
     archive block, because a pending the archive still holds is exactly what
     an earlier uncertain failure may have left behind — blocking on the flag
     first would make it unreachable forever. */
  let settled: 'clear' | 'settled' | 'blocked'
  try {
    settled = await settlePending($, currentProject)
  } catch (error) {
    return holdSubmission($, currentProject, failureCategory(error, 'capture-list'), '无法读取未决的 Pending Capture')
  }
  if (settled !== 'clear') {
    /* A submission that met a reconciliation is never sent on the person's
       behalf, whether or not it succeeded: the draft goes back and they
       press Enter again. */
    const restored = await restoreDraft($, e.text)
    return {
      done: {
        drop: settled === 'settled'
          ? `Prompt Trail 已完成对账，${draftNote(restored)}；请重新提交。`
          : `Prompt Trail 仍有未决的 Pending Capture 待对账，${draftNote(restored)}；本次提交未进入会话。`,
      },
    }
  }

  /* After the pending is settled and before anything new is staged: the
     Pending Capture belongs to the segment before the `/clear`, so it is
     archived first, and the Clear Boundary then takes the sequence that
     separates it from this submission. */
  if (await drainLifecycle($, currentProject) === 'blocked') {
    return holdSubmission(
      $,
      currentProject,
      lifecycleFailure ?? 'lifecycle-write',
      '无法补写中断的 Clear Boundary 或 Run 边界',
    )
  }

  /* A failure on record stops the submission before it tries, unless the
     person asked to try again. */
  if (archiveFailure?.blocking && !retrying) {
    return { blocked: { ...archiveFailure, reason: '档案当前不可用' } }
  }

  /* A resumed or forked session may already hold history this Run's branch
     has to continue from; it is settled before anything is staged. */
  if (timelineLoaded !== currentProject.id) {
    try {
      await loadTimeline($, currentProject)
    } catch {
      // Candidates it cannot show are offered by event id.
    }
  }
  const aligned = await alignBranch($, currentProject, e.text)
  if ('failed' in aligned) {
    return holdSubmission($, currentProject, aligned.failed, '无法重建 Conversation Branch')
  }
  if ('drop' in aligned) return { done: aligned }

  let branch: { key: string; value: BranchState }
  const eventId = crypto.randomUUID()
  const attachmentKinds = e.attachments?.map(attachment => attachment.type) ?? []
  let staged: Staged
  try {
    branch = await branchState($, currentProject)
    const begin = async () => beginCapture(
      $,
      currentProject,
      branch.value,
      eventId,
      await $.clock.now(),
      e.text,
      attachmentKinds,
    )
    try {
      staged = await begin()
    } catch (error) {
      const category = failureCategory(error, 'capture-begin')
      const left = branch.value.generation
      if (category === 'capture-parent-unknown' && branch.value.parentEventId) {
        /* A Run clear took the entry this branch stood on: what follows
           starts a new root rather than chaining onto nothing. */
        branch = await rootAfterRunClear($, branch)
      } else if (category === 'archive-generation' && left) {
        branch = await enterNewGeneration($, currentProject, left)
      } else {
        throw error
      }
      staged = await begin()
    }
  } catch (error) {
    /* The helper may have committed the pending row and died before saying
       so, so this Run stops trusting its earlier "nothing owed" answer and
       asks the archive again on the next submission. */
    pendingDiscovered = false
    return holdSubmission($, currentProject, failureCategory(error, 'capture-begin'), '无法预写 Pending Capture')
  }
  /* Staged: from here a hook that stops leaves a pending to reconcile rather
     than a prompt nothing records. Unrecorded, the marker still says an
     earlier stage, which over-reports a gap and never hides one. */
  const markerKey = markers.get(call)
  if (markerKey) {
    try {
      const held = storedMarker(await $.store.get(markerKey))
      if (held) await $.store.set(markerKey, { ...held, stage: 'pending' })
    } catch {
      // Left at the earlier stage.
    }
  }
  if (branch.value.generation !== staged.generation) {
    branch = { key: branch.key, value: { ...branch.value, generation: staged.generation } }
    try {
      await $.store.set(branch.key, branch.value)
      rememberBranch(branch.key, branch.value)
    } catch {
      // Unrecorded, the next capture names no generation and learns it again.
    }
  }
  await noteDiskSpace($, currentProject, staged.lowSpace)

  let result: PromptSubmitResult
  try {
    result = await next(e)
  } catch (error) {
    /* The capture is staged and the submission's fate is unknown, so the
       pending must be rediscoverable. The host failed, not the archive:
       nothing is put on record. */
    pendingDiscovered = false
    throw error
  }
  const finalText = result.text
  if (typeof finalText !== 'string') {
    try {
      await abortCapture($, currentProject, eventId)
    } catch (error) {
      await markUnavailable($, currentProject, failureCategory(error, 'capture-abort'))
    }
    return { done: result }
  }

  /* `/prompt-history disable` runs immediately, so it can land while this
     submission is still in flight. The stop boundary says later prompts were
     not recorded, so a capture the stop overtook is discarded rather than
     archived inside the disabled interval. */
  let stillCollecting = true
  try {
    stillCollecting = (await loadRunMode($, currentProject)).value.mode === 'enabled'
  } catch {
    stillCollecting = false
  }
  if (!stillCollecting) {
    try {
      await abortCapture($, currentProject, eventId)
    } catch (error) {
      await markUnavailable($, currentProject, failureCategory(error, 'capture-abort'))
    }
    return { done: result }
  }

  let confirmed: Confirmed | undefined
  try {
    confirmed = await confirmCapture($, currentProject, eventId, finalText)
  } catch (error) {
    await markUnavailable($, currentProject, failureCategory(error, 'capture-confirm'))
  }
  try {
    if (!confirmed) throw new Error('capture-confirm')
    const nextBranch: BranchState = {
      ...branch.value,
      parentEventId: eventId,
    }
    await $.store.set(branch.key, nextBranch)
    rememberBranch(branch.key, nextBranch)
    transcriptMark = { key: branch.key, mark: markTranscript(aligned.messages, finalText) }
    appendToWindow($, {
      kind: 'prompt',
      eventId,
      sequence: confirmed.sequence,
      ordinal: confirmed.ordinal,
      runId: startup.runId ?? '',
      ...(startup.sessionId ? { segmentId: startup.sessionId } : {}),
      branchId: branch.value.branchId,
      parentEventId: branch.value.parentEventId,
      text: finalText,
      attachmentCount: attachmentKinds.length,
    })
  } catch {
    /* The prompt did enter the session, so the pending is kept rather than
       dropped, and this Run collects nothing further until the outcome is
       settled. The final text stays in memory so a reconciliation in this
       module instance can still archive exactly what entered. */
    await saveReconcile(
      $,
      currentProject,
      {
        version: 1,
        eventId,
        runId: startup.runId ?? branch.value.branchId,
        branchId: branch.value.branchId,
        parentEventId: branch.value.parentEventId,
        attachmentCount: attachmentKinds.length,
        generation: staged.generation,
      },
      finalText,
    )
  }
  return { done: result }
}

/* One composer submission of a collecting Run, held and asked about for as
   long as the archive cannot prove it will be kept. */
async function collectSubmission(
  $: EngineInterface,
  e: PromptSubmitInput,
  next: (e: PromptSubmitInput) => Promise<PromptSubmitResult>,
  call: string,
  markers: Map<string, string>,
): Promise<PromptSubmitResult> {
  /* A collecting Run that cannot prove this submission will be kept holds
     it, and the person chooses: retry, or disable the Run and let it
     through. Every retry is theirs; nothing retries in the background. */
  for (let retrying = false; ; retrying = true) {
    const outcome = await submitCollected($, e, next, retrying, call, markers)
    if ('done' in outcome) return outcome.done
    const failure = outcome.blocked
    let choice = await askUnavailable($, failure)
    while (choice === 'recheck' || choice === 'quarantine' || choice === 'clear' || choice === 'continue-clear') {
      const settled = choice === 'clear' || choice === 'continue-clear'
        ? await answerClear($, choice, failure)
        : await answerDamage($, choice, failure)
      if (settled) break
      choice = await askUnavailable($, failure)
    }
    if (choice !== 'disable' && choice !== undefined) continue
    if (choice === 'disable') {
      const note = await disableCollection($)
      if (runMode?.value.mode === 'disabled') {
        $.ui.toast(note)
        /* Let through by the person's choice, not by a failure: whatever the
           host does with it now is no gap. */
        await removeMarker($, markers.get(call))
        markers.delete(call)
        return next(e)
      }
      const restored = await restoreDraft($, e.text)
      return { drop: `${note}${draftNote(restored)}；本次提交未进入会话。` }
    }
    const restored = await restoreDraft($, e.text)
    return {
      drop: `Prompt Trail ${failure.reason}（${failure.category}），${draftNote(restored)}；为避免漏记，本次提交已阻止。`,
    }
  }
}

/* The draft belongs to the person, not to the submission Prompt Trail
   refused: it goes back into the composer, and they decide whether to send
   it again. */
async function restoreDraft($: EngineInterface, text: string): Promise<boolean> {
  try {
    const filled = await $.prompt.fill({ text })
    return filled.isFilled !== false
  } catch {
    return false
  }
}

/* Never claim the draft came back when it did not: a dialog holding the keys
   or a surface with no prompt box both answer `isFilled: false`. */
function draftNote(restored: boolean): string {
  return restored ? '草稿已恢复' : '草稿未能恢复，请重新输入'
}

/* One row of the expanded list: the entry's text folded to a single line, or a
   marker for an attachment-only submission, which archives no text at all. */
function entryLine(entry: Extract<TimelineItem, { kind: 'prompt' }>): string {
  if (entry.text === '') {
    return entry.attachmentCount > 0 ? `（附件 ×${entry.attachmentCount}）` : '（空提交）'
  }
  return entry.text.replace(/\r\n?|\n/g, ' ↵ ')
}

/* A disabled interval is drawn as an explicit break, never as continuous
   history: the stop marker says the prompts after it were not recorded and the
   resume marker says nothing from that interval is reconstructed. */
function boundaryLine(kind: BoundaryKind | 'run-unclosed', splitFrom?: string): string {
  if (kind === 'clear') {
    return '—— /clear：新的 Conversation Segment ——'
  }
  if (kind === 'run-started') {
    /* A Run that began inside a session another Run already holds: a second
       process resumed that session while the first was still in it. */
    return splitFrom ? `—— Run 开始（从 Run ${splitFrom.slice(0, 8)} 分出）——` : '—— Run 开始 ——'
  }
  if (kind === 'run-attached') return '—— Run 续接 ——'
  /* The first event of a generation a quarantine started: what came before
     is kept, unchanged, outside this timeline. */
  if (kind === 'archive-quarantined') return '—— 此前的记录已隔离（原样保留，不在本时间线中）——'
  if (kind === 'run-detached') return '—— Run 离开 ——'
  /* Drawn, never archived: the archive cannot tell a process that crashed from
     one still running elsewhere, and this claims only what it knows. */
  if (kind === 'run-unclosed') return '—— Run 未记录离开 ——'
  if (kind === 'integrity-gap') return '—— Integrity gap：此前的记录无法证明与对话一致 ——'
  if (kind === 'integrity-recovery') return '—— 已恢复可验证采集（此前的缺口不会补齐）——'
  if (kind === 'collection-started') return '—— 采集已开始 ——'
  if (kind === 'collection-stopped') {
    return '—— 采集已停止（其后的 prompt 未记录）——'
  }
  return '—— 采集已恢复（新根分支；停用期间的 prompt 不补录）——'
}

function boundarySummary(mode: RunModeState | undefined): string {
  if (mode?.stopBoundaryMissing) return 'collection-stopped · 未能写入档案'
  if (!mode?.boundary) return 'none'
  return `${mode.boundary.kind} · sequence ${mode.boundary.sequence}`
}

/* Enough to identify the unresolved event and nothing more: no draft, no
   prompt text, not even its length. */
function reconcileSummary(): string {
  const elsewhere = pendingElsewhere ? ` · 另有 ${pendingElsewhere} 条属于正在运行的其他 Run` : ''
  if (reconcile) return `${reconcile.state.eventId.slice(0, 8)} · 待对账${elsewhere}`
  if (pendingUnknown) return `unknown · 未决 Pending Capture 不可读（${pendingUnknown}）`
  return `none${elsewhere}`
}

/* What a recovery queue still owes, by kind, so an owed Run start never reads
   as a Clear Boundary. */
function owedText(queue: readonly LifecycleWrite[]): string {
  const clears = queue.filter(write => write.kind === 'clear').length
  const runs = queue.length - clears
  return [
    ...(clears ? [`${clears} 条 Clear Boundary 待补写`] : []),
    ...(runs ? [`${runs} 条 Run 边界待补写`] : []),
  ].join(' · ')
}

/* What the lifecycle record knows about the latest `/clear`, and what the
   archive still owes because of one. This is where an interrupted transition
   becomes visible: the boundary was written, but no `source=clear` start ever
   claimed it, and the Run that would have is gone. */
function clearSummary(): string {
  const state = lifecycle?.value
  if (!state) return 'unknown · lifecycle 记录不可读'
  const parts: string[] = []
  if (deferredClear) {
    parts.push(`${deferredClear.sessionId.slice(0, 8)} · 已观察到 /clear 但尚未记录，待下次提交前补写`)
  }
  const clear = state.clear
  const phase = clearTransitionState(state, startup.runId)
  if (!clear || phase === 'none') {
    parts.push('none')
  } else {
    const identity = clear.eventId.slice(0, 8)
    parts.push(
      phase === 'complete'
        ? `${identity} · 已完成`
        : phase === 'open'
          ? `${identity} · 等待 source=clear 的 SessionStart`
          : `${identity} · 未完成转换（进程在 SessionEnd 与 SessionStart 之间退出）`,
    )
    if (clear.priorUnfinished) parts.push('上一次转换未完成')
  }
  if (state.queue.length > 0) {
    parts.push(owedText(state.queue))
    if (lifecycleFailure) parts.push(`上次补写失败：${statusValue(lifecycleFailure)}`)
  }
  if (lifecycleOthers?.queue.length) {
    parts.push(`其他 Run 遗留 ${owedText(lifecycleOthers.queue)}`)
  }
  if (lifecycleOthers?.unfinished) {
    parts.push(`其他 Run 有 ${lifecycleOthers.unfinished} 次未完成转换`)
  }
  return parts.join(' · ')
}

/* Why this Run is or is not collecting, most specific reason first. */
function collectionModeText(): string {
  if (!runMode) return 'unknown · Run collection mode 不可读'
  if (runMode.value.mode === 'disabled') return 'disabled · 本 Run 已停用采集'
  if (project?.consent !== 'enabled') return 'disabled · 未授予 Collection consent'
  if (reconcile) return 'disabled · 未决 Pending Capture 待对账'
  if (pendingUnknown) return `unknown · 未决 Pending Capture 不可读（${pendingUnknown}）`
  if (!lifecycle) return 'unknown · lifecycle 记录不可读'
  if (deferredClear) return 'disabled · 已观察到 /clear 但尚未记录'
  const owed = [...lifecycle.value.queue, ...lifecycleOthers?.queue ?? []]
  if (owed.length > 0) {
    return owed.some(write => write.kind === 'clear')
      ? 'disabled · Clear Boundary 待补写'
      : 'disabled · Run 边界待补写'
  }
  if (archiveFailure) return 'disabled · 档案不可用'
  if (startup.support !== 'supported') {
    return `disabled · ${statusValue(startup.reason)}`
  }
  return 'enabled'
}

function statusValue(value: string): string {
  return value.replace(
    /[\u0000-\u001f\u007f]/g,
    character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )
}

/* Whether this Run's records are provable now, and what it still owes when
   they are not. */
function integritySummary(): string {
  const state = lifecycle?.value
  if (!state) return 'unknown · lifecycle 记录不可读'
  const owed = state.gap && !state.gap.landed ? state.gap.reasons : []
  const losses = [...owed, ...lossReasons(state).filter(reason => !owed.includes(reason))]
  const parts = losses.length > 0
    ? [`gap owed · ${gapReasonsText(losses)}（下一次提交前写入时间线）`]
    : state.gap?.landed
      ? ['gap recorded · 恢复边界待写入']
      : ['healthy']
  if (unsettledCalls > 0) {
    parts.push(`${unsettledCalls} 次提交未正常结束，下一次提交时判定是否形成 Integrity gap`)
  }
  return parts.join(' · ')
}

function integrityGapsSummary(): string {
  const gaps = archiveStatus?.integrityGaps
  if (gaps === undefined || gaps === null) return 'unknown'
  return gaps > 0 ? `${gaps} · 本项目的时间线跨越这些 Integrity gap 的部分不完整` : '0'
}

function statusText(): string {
  const helperPath = startup.helperPath
    ? statusValue(startup.helperPath)
    : undefined
  const helper = startup.helperTrusted
    ? `trusted · ${helperPath ?? 'unproven path'}`
    : startup.support === 'helper unavailable'
      ? `unavailable${helperPath ? ` · ${helperPath}` : ''}`
      : startup.support === 'checking'
        ? 'checking'
        : `not checked${helperPath ? ` · ${helperPath}` : ''}`
  const consentState = project?.consent === 'enabled'
    ? 'granted'
    : project?.consent === 'declined'
      ? 'declined'
      : 'not granted'
  const consent = `${consentState} · policy ${COLLECTION_POLICY_VERSION}`
  /* The Run switch and what it actually amounts to are reported together, so a
     Run that is switched on but not collecting never reads as collecting. */
  const collectionMode = collectionModeText()
  const archive = archiveFailure
    ? `unavailable · 范围 ${archiveFailure.scope} · 类别 ${archiveFailure.category}${archiveFailure.elsewhere ? ' · 由另一个 Run 报告' : ''}${archiveFailure.recheck ? ` · ${recheckNote(archiveFailure.recheck)}` : ''}`
    : project?.archiveReady && project.databasePath
      ? `ready · ${statusValue(project.databasePath)}`
      : 'not created'
  const damageChoices = archiveFailure && DAMAGE_FAILURES.has(archiveFailure.category)
    ? ['choices: 重新检查完整性 / 隔离并开始新档案 / 清除全部档案 / 禁用当前 Run 后继续（在下一次提交时选择）']
    : []
  return [
    'Prompt Trail status',
    `support: ${startup.support}`,
    `reason: ${startup.reason}`,
    `target: ${TARGET}`,
    `not promised: ${NOT_PROMISED}`,
    `detected: ${statusValue(startup.detected)}`,
    `collection consent: ${consent}`,
    `Run collection mode: ${collectionMode}`,
    `latest collection boundary: ${boundarySummary(runMode?.value)}`,
    `pending reconciliation: ${reconcileSummary()}`,
    `clear transition: ${clearSummary()}`,
    `integrity: ${integritySummary()}`,
    `integrity gaps: ${integrityGapsSummary()}`,
    `archive: ${archive}`,
    ...damageChoices,
    ...quarantineLines(),
    `disk space: ${diskSpace}`,
    `project: ${startup.projectPath ? statusValue(startup.projectPath) : 'unavailable'}`,
    `database root: ${startup.databaseRoot ? statusValue(startup.databaseRoot) : 'unavailable'}`,
    `helper: ${helper}`,
    `locator: ${startup.locatorPath ? statusValue(startup.locatorPath) : 'unavailable'}`,
    `run: ${startup.runId ?? 'unavailable'}`,
  ].join('\n')
}

/* The generation in place and every quarantined archive, by place and size
   only; `unknown` when the helper could not be asked. */
function quarantineLines(): string[] {
  if (!archiveStatus) return ['Archive generation: unknown']
  return [
    `Archive generation: ${archiveStatus.generation ? archiveStatus.generation.slice(0, 12) : 'none'}`,
    ...(archiveStatus.quarantineUnderway ? ['quarantine: 未完成（再次选择“隔离并开始新档案”会接着完成）'] : []),
    ...(archiveStatus.clearUnderway
      ? [`clear: unfinished · ${archiveStatus.clearResidual ?? 'unknown'} residual（/prompt-history clear-all 可继续）`]
      : []),
    ...(archiveStatus.clearRunUnderway
      ? [`clear-run: unfinished · ${archiveStatus.clearRunResidual ?? 'unknown'} residual（/prompt-history clear-run 可继续）`]
      : []),
    `Quarantined archives: ${archiveStatus.quarantined.length}`,
    ...archiveStatus.quarantined.map(kept => `  ${statusValue(kept.path)}（${kept.bytes} bytes）`),
  ]
}

async function refreshStartup($: EngineInterface): Promise<void> {
  if (!runtimeTarget) return
  try {
    startup = await inspectTarget(
      $,
      runtimeTarget.isInteractive,
      runtimeTarget.surface,
      runtimeTarget.cwd,
    )
    if (RETRYABLE_LOCATOR_REASONS.has(startup.reason)) {
      startup = await inspectTarget(
        $,
        runtimeTarget.isInteractive,
        runtimeTarget.surface,
        runtimeTarget.cwd,
      )
    }
    forgetOtherRunsFailure()
  } catch {
    startup = {
      support: 'helper unavailable',
      reason: 'preflight-failed',
      detected: 'target could not be proven',
      projectPath: runtimeTarget.cwd,
    }
  }
}

/* A session the host started a moment ago can run its hooks before the bridge
   has published its locator: a background `/fork` submits its argument about
   a second before, and a conversation moved to a background session gets its
   locator there only once it is taken up. The first submission that meets such a
   session waits for it, briefly and once, rather than refusing; a host whose
   bridge never runs costs that wait a single time. */
const LOCATOR_WAIT_MS = 2_000
const LOCATOR_POLL_MS = 200

async function awaitStartup($: EngineInterface): Promise<void> {
  let sessionId: string
  try {
    sessionId = await $.session.id()
  } catch {
    return
  }
  /* The proven Run must be this session's: an in-process `/resume` moves the
     process to a session whose locator may not be published yet either. */
  if (startup.support === 'supported' && startup.runId && startup.sessionId === sessionId) return
  await refreshStartup($)
  if (locatorAwaited === sessionId) return
  locatorAwaited = sessionId
  for (
    let waited = 0;
    waited < LOCATOR_WAIT_MS && !startup.runId && RETRYABLE_LOCATOR_REASONS.has(startup.reason);
    waited += LOCATOR_POLL_MS
  ) {
    await $.clock.sleep(LOCATOR_POLL_MS)
    await refreshStartup($)
  }
}

/* The archived events are read back once per project, whenever the target is
   first proven: at start when the locator is already there, or later when it
   arrives. The band never stays empty only because it was drawn too early. */
async function ensureTimeline($: EngineInterface): Promise<void> {
  if (startup.support !== 'supported') return
  try {
    const currentProject = await prepareProject($)
    if (timelineLoaded !== currentProject.id) await loadTimeline($, currentProject)
  } catch {
    // The band shows what this module instance records from here on.
  }
}

/* Idempotent by event id: a boundary can be appended more than once — the
   helper answers the stored sequence rather than cutting twice — and the
   timeline must still show exactly one row for it. */
function recordBoundary(
  $: EngineInterface,
  kind: BoundaryKind,
  appended: { eventId: string; sequence: number },
  runId: string = startup.runId ?? '',
  segmentId: string | undefined = startup.sessionId,
): void {
  appendToWindow($, {
    kind: 'boundary',
    eventId: appended.eventId,
    sequence: appended.sequence,
    runId,
    ...(segmentId ? { segmentId } : {}),
    boundary: kind,
  })
}

/* Turning the current Run's collection on. It never reports success from an
   unsupported or unhealthy target, and a real off-to-on transition starts a
   fresh root Conversation Branch so nothing from the disabled interval is
   back-filled onto the new lineage. */
async function enableCollection($: EngineInterface): Promise<string> {
  if (!runtimeTarget) return 'Prompt Trail 尚未确定运行目标，无法启用采集。'

  let currentProject: ProjectState
  try {
    currentProject = await prepareProject($)
  } catch {
    return 'Prompt Trail 无法证明当前项目身份，未启用采集。'
  }

  await refreshStartup($)
  if (startup.support !== 'supported') {
    return `Prompt Trail 在当前环境不可采集（${startup.support}：${startup.reason}），未启用采集。`
  }
  if (!startup.databaseRoot) {
    return 'Prompt Trail 无法证明数据库位置，未启用采集。'
  }
  currentProject.databasePath = `${startup.databaseRoot}/${currentProject.id}.sqlite3`
  startup.projectPath = currentProject.root

  const hadConsent = currentProject.consent === 'enabled'
  let decision: ConsentDecision | undefined
  try {
    decision = await requestConsent($, currentProject)
  } catch {
    return 'Prompt Trail 无法完成采集同意，未启用采集。'
  }
  if (decision === 'declined') {
    return '这个 Project Timeline 未授予 Collection consent，采集保持关闭。'
  }
  if (decision !== 'enabled') {
    return '请选择“启用”或“继续但不启用”后再运行 /prompt-history enable。'
  }

  /* Resuming over an unreconciled submission would archive the next prompt
     without ever settling the last one, so enable reconciles first — ahead of
     the archive block, which an earlier uncertain failure may have raised over
     the very pending that needs settling — and refuses while anything is owed. */
  /* What an earlier call left unfinished is judged first, so a gap it owes
     lands ahead of the resume and a pending it staged is listed below. */
  try {
    await settleInflight($, currentProject)
  } catch {
    return 'Prompt Trail 无法确认上一次提交是否完整（inflight-unreadable），未启用采集。'
  }
  try {
    if (await settlePending($, currentProject) === 'blocked') {
      return '仍有未决的 Pending Capture 待对账，未启用采集；请先完成对账。'
    }
  } catch (error) {
    const failure = await markUnavailable($, currentProject, failureCategory(error, 'capture-list'))
    return `Prompt Trail 无法读取未决的 Pending Capture（${failure.category}），未启用采集。`
  }

  /* A resume boundary written ahead of a Clear Boundary that is still owed
     would order the segment break after the interval it precedes, so the queue
     is emptied first and enable refuses while anything is left in it. */
  if (await drainLifecycle($, currentProject, false) === 'blocked') {
    const failure = lifecycleFailure
      ? `（${(await markUnavailable($, currentProject, lifecycleFailure)).category}）`
      : ''
    return `Prompt Trail 仍有中断的 Clear Boundary 或 Run 边界待补写${failure}，未启用采集。`
  }

  /* Already collecting means the switch is on and consent was granted before
     this command ran; there is no transition to mark. */
  let current: { key: string; value: RunModeState }
  try {
    current = await loadRunMode($, currentProject)
  } catch {
    return 'Prompt Trail 无法读取当前 Run collection mode，未启用采集。'
  }
  if (current.value.mode === 'enabled' && hadConsent && !current.value.stopBoundaryMissing) {
    return '当前 Run 已在采集，未写入新的 Collection Boundary。'
  }

  /* A resume whose matching stop boundary never reached the archive would
     present the disabled interval as continuous history, so the stop is
     retried first and the resume waits until it lands. */
  if (current.value.stopBoundaryMissing) {
    let stop: { eventId: string; sequence: number }
    try {
      const branch = await branchState($, currentProject)
      stop = await appendBoundary(
        $,
        currentProject,
        branch.value.branchId,
        'collection-stopped',
      )
    } catch {
      return '上一次停用的 Collection Boundary 仍未写入档案；在它写入前不恢复采集，否则禁用区间会被显示为完整历史。'
    }
    recordBoundary($, 'collection-stopped', stop)
    current = {
      key: current.key,
      value: {
        version: 1,
        mode: current.value.mode,
        boundary: { kind: 'collection-stopped', ...stop },
      },
    }
    await saveRunMode($, current.key, current.value)
  }

  const kind: CollectionBoundaryKind = current.value.mode === 'disabled'
    ? 'collection-resumed'
    : 'collection-started'
  const branchId = crypto.randomUUID()
  let appended: { eventId: string; sequence: number }
  try {
    appended = await appendBoundary($, currentProject, branchId, kind)
  } catch (error) {
    const failure = await markUnavailable($, currentProject, failureCategory(error, 'boundary-append'))
    const damage = DAMAGE_FAILURES.has(failure.category)
      ? '档案已损坏：下一次提交时可选择重新检查完整性、隔离并开始新档案，或禁用当前 Run 后继续。'
      : ''
    return `Prompt Trail 无法写入 Collection Boundary（${failure.category}），未启用采集。${damage}`
  }

  try {
    if (startup.runId && startup.sessionId) {
      const key = branchKey(currentProject.id, startup.runId, startup.sessionId)
      const root: BranchState = { version: 1, branchId, parentEventId: null, explicitRoot: true }
      await $.store.set(key, root)
      rememberBranch(key, root)
    }
    await saveRunMode($, current.key, {
      version: 1,
      mode: 'enabled',
      boundary: { kind, eventId: appended.eventId, sequence: appended.sequence },
    })
  } catch {
    return '已写入 Collection Boundary，但无法保存 Run collection mode；reload 后状态可能回到默认值。'
  }

  recordBoundary($, kind, appended)
  $.ui.invalidate('ui.render')
  /* Collection is provable again from here. Left unwritten, the next
     submission's drain writes it before anything is staged. */
  await recordIntegrityGap($, currentProject, true)
  return kind === 'collection-resumed'
    ? '当前 Run 已恢复采集，并从新的根 Conversation Branch 开始；停用期间的 prompt 不补录。'
    : '当前 Run 已开始采集，并从新的根 Conversation Branch 开始。'
}

/* Turning the current Run's collection off. Stopping always takes effect —
   that is the direction that cannot lose data — and the Collection Boundary is
   attempted afterwards and reported honestly if it could not be written. */
async function disableCollection($: EngineInterface): Promise<string> {
  if (!runtimeTarget) return 'Prompt Trail 尚未确定运行目标，无法停用采集。'

  let currentProject: ProjectState
  try {
    currentProject = await prepareProject($)
  } catch {
    return 'Prompt Trail 无法证明当前项目身份，未改变 Run collection mode。'
  }

  let current: { key: string; value: RunModeState }
  try {
    current = await loadRunMode($, currentProject)
  } catch {
    return 'Prompt Trail 无法读取当前 Run collection mode，未改变采集开关。'
  }
  if (current.value.mode === 'disabled') {
    return '当前 Run 已停用采集，未写入新的 Collection Boundary。'
  }

  /* Refreshed before the boundary and never before the switch: stopping has to
     take effect whatever the target says, but a boundary must name the
     Conversation Segment that is current now. After a `/clear` the cached
     startup still names the segment that ended. */
  await refreshStartup($)

  /* The boundary is attempted even when the archive is already flagged
     unavailable: the flag can be stale, and a stop that lands is what keeps
     the disabled interval from reading as continuous history. */
  const kind: CollectionBoundaryKind = 'collection-stopped'
  let appended: { eventId: string; sequence: number } | undefined
  if (
    startup.support === 'supported' &&
    startup.databaseRoot &&
    currentProject.consent === 'enabled'
  ) {
    try {
      /* The stop is a write of this Run, so the Run's start and whatever it
         already owes land first — after what other Runs owe, where that can
         land. Another Run's stuck debt does not stand in the way of stopping. */
      if (!await ensureRunAttached($, currentProject)) throw new Error('lifecycle-owed')
      await flushForeignLifecycles($, currentProject)
      if (!await flushOwnLifecycle($, currentProject)) throw new Error('lifecycle-owed')
      /* A gap it owes lands ahead of the stop; its recovery waits for a
         resume, since nothing is collected in between to prove. */
      if (!await recordIntegrityGap($, currentProject, false)) throw new Error('lifecycle-owed')
      const branch = await branchState($, currentProject)
      appended = await appendBoundary($, currentProject, branch.value.branchId, kind)
    } catch {
      appended = undefined
    }
  }

  const boundaryRequired = currentProject.consent === 'enabled'
  const value: RunModeState = {
    version: 1,
    mode: 'disabled',
    ...(appended
      ? {
        boundary: {
          kind,
          eventId: appended.eventId,
          sequence: appended.sequence,
        },
      }
      : {}),
    ...(boundaryRequired && !appended ? { stopBoundaryMissing: true as const } : {}),
  }
  let persisted = true
  try {
    await saveRunMode($, current.key, value)
  } catch {
    persisted = false
    runMode = { key: current.key, value }
  }

  if (appended) {
    recordBoundary($, kind, appended)
    $.ui.invalidate('ui.render')
  }
  const boundaryNote = !boundaryRequired
    ? '该项目尚未授予 Collection consent，本就没有采集，未写入 Collection Boundary'
    : appended
      ? '已写入 Collection Boundary'
      : '未能写入 Collection Boundary；在它补写成功前 enable 不会恢复采集'
  const persistenceNote = persisted
    ? ''
    : '；无法保存 Run collection mode，reload 后可能回到默认值'
  return `当前 Run 已停用采集，${boundaryNote}${persistenceNote}。既有 Prompt Entries、Collection consent 和其他 Run 均未改变。`
}

/* Best effort: a band that reopens collapsed after a reload costs one click,
   and is no reason to fail the toggle. */
async function saveExpanded($: EngineInterface): Promise<void> {
  if (!startup.runId) return
  try {
    await $.store.set(uiKey(startup.runId), { version: 1, expanded })
  } catch {
    // Kept in memory for this module instance.
  }
}

/* One row of the expanded band, a line each: a Prompt Entry (a stop for the
   focus ring), a fold, or a line of text. */
type BandRow = {
  key: string
  text: string
  dim: boolean
  /* A row that says the history around it cannot be proven complete. */
  warn?: true
  fold?: string
  entry?: true
  eventId?: string
}

function isIntegrityRow(item: TimelineItem): boolean {
  return item.kind === 'boundary'
    && (item.boundary === 'integrity-gap' || item.boundary === 'integrity-recovery')
}

/* Every row the band's window holds, in order; the view shows a stretch of
   them under the title. */
function bandRows(): BandRow[] {
  const ordered = timeline
  const attachment = lifecycle?.key.endsWith(`:${startup.runId}`)
    ? lifecycle.value.attachment
    : undefined
  const unclosed = unrecordedLeavings(
    ordered,
    attachment !== undefined && !attachment.closed && attachment.host === startup.hostGeneration,
  )
  const origins = splitOrigins(ordered)
  const forks = forkSources(ordered, parentRuns)
  const starts = branchStarts(ordered, parentRuns)
  const currentKey = project && startup.runId && startup.sessionId
    ? branchKey(project.id, startup.runId, startup.sessionId)
    : undefined
  const tip = activeBranch && activeBranch.key === currentKey ? activeBranch.value.parentEventId : null
  const folds = foldTimeline(
    ordered,
    startup.runId ?? '',
    tip,
    activePath && activePath.tip === tip ? activePath : undefined,
  )
  const rows = ordered.flatMap((item): BandRow[] => {
    const before: BandRow[] = []
    /* Another Run's fold holds its boundaries too, so it may begin at one. */
    const fold = folds.folded.get(item.eventId)
    if (fold === item.eventId) {
      const open = openFolds.has(fold)
      before.push({
        key: `prompt-trail:fold:${fold}`,
        text: `${open ? '▾' : '▸'} ${folds.runs.has(fold) ? '另一 Run' : '另一分支'} · ${folds.counts.get(fold) ?? 0} 条`,
        dim: true,
        fold,
      })
    }
    if (fold !== undefined && !openFolds.has(fold)) {
      /* Neither a Run left unrecorded nor an Integrity gap is ever hidden
         inside a fold. */
      if (isIntegrityRow(item) && item.kind === 'boundary') {
        before.push({
          key: `prompt-trail:boundary:${item.eventId}`,
          text: boundaryLine(item.boundary),
          dim: false,
          warn: true,
        })
      }
      return unclosed.has(item.eventId)
        ? [...before, { key: `prompt-trail:unclosed:${item.eventId}`, text: boundaryLine('run-unclosed'), dim: true }]
        : before
    }
    if (item.kind === 'prompt') {
      const start = starts.get(item.eventId)
      if (item.parentEventId === null && item.branchId && ambiguousRoots.has(item.branchId)) {
        before.push({
          key: `prompt-trail:unlinked:${item.eventId}`,
          text: '—— 共享前缀无法唯一确定，未接续 ——',
          dim: true,
        })
      } else if (start !== undefined) {
        before.push({
          key: `prompt-trail:branch-start:${item.eventId}`,
          text: start === 'root' ? '—— 新根分支 ——' : '—— 新分支 ——',
          dim: true,
        })
      }
    }
    const drawn: BandRow = item.kind === 'boundary'
      ? {
          key: `prompt-trail:boundary:${item.eventId}`,
          text: boundaryLine(
            item.boundary,
            item.boundary === 'run-started'
              ? forks.get(item.runId) ?? segmentOrigins.get(item.eventId) ?? origins.get(item.eventId)
              : origins.get(item.eventId),
          ),
          ...(isIntegrityRow(item) ? { dim: false, warn: true as const } : { dim: true }),
        }
      : jumpTable.has(item.eventId)
        ? {
            key: `prompt-trail:prompt:${item.eventId}`,
            text: `${item.ordinal}. ${entryLine(item)}`,
            dim: false,
            entry: true,
            eventId: item.eventId,
          }
        /* No row of the current transcript is this entry's: it stays, marked
           as one that cannot be jumped to. */
        : {
            key: `prompt-trail:prompt:${item.eventId}`,
            text: `× ${item.ordinal}. ${entryLine(item)}`,
            dim: true,
            entry: true,
            eventId: item.eventId,
          }
    const runId = unclosed.get(item.eventId)
    return runId === undefined
      ? [...before, drawn]
      : [...before, drawn, { key: `prompt-trail:unclosed:${item.eventId}`, text: boundaryLine('run-unclosed'), dim: true }]
  })
  /* A window holding nothing the arrows can stop on still needs a way past
     its ends. */
  const focusable = rows.filter(row => row.entry || row.fold !== undefined)
  if (focusable.length === 0 && timelineEdges.earlier) {
    rows.unshift({ key: 'prompt-trail:earlier', text: '↑ 更早的事件', dim: true, entry: true })
  }
  if (focusable.length === 0 && timelineEdges.later) {
    rows.push({ key: 'prompt-trail:later', text: '↓ 更晚的事件', dim: true, entry: true })
  }
  return rows
}

function stopKeys(rows: readonly BandRow[]): string[] {
  return rows.filter(row => row.entry || row.fold !== undefined).map(row => row.key)
}

/* Where the band marks a stretch of a Run whose leaving was never recorded:
   after that Run's last row before it was taken up again, and after the last
   row of any other Run still open at the end of the view. The current Run's
   open stretch, once this process has opened it, is this process, which has
   not left. Without an opening in view there is nothing to say the Run was
   ever open. */
function unrecordedLeavings(
  items: readonly TimelineItem[],
  ownStretchOpen: boolean,
): Map<string, string> {
  const open = new Map<string, boolean>()
  const last = new Map<string, string>()
  const markers = new Map<string, string>()
  for (const item of items) {
    if (item.kind === 'boundary'
        && (item.boundary === 'run-started' || item.boundary === 'run-attached')) {
      const previous = last.get(item.runId)
      if (open.get(item.runId) && previous) markers.set(previous, item.runId)
      open.set(item.runId, true)
    }
    if (item.kind === 'boundary' && item.boundary === 'run-detached') open.set(item.runId, false)
    last.set(item.runId, item.eventId)
  }
  for (const [runId, isOpen] of open) {
    const eventId = last.get(runId)
    /* The current Run left open by an earlier process — a crash this process
       resumed — is marked too, until this process opens its own stretch. */
    if (isOpen && eventId && (runId !== startup.runId || !ownStretchOpen)) {
      markers.set(eventId, runId)
    }
  }
  return markers
}

/* Which Run each Run start split off from: the Run that already held the
   session the start was written in, as far as the view reaches back. */
function splitOrigins(items: readonly TimelineItem[]): Map<string, string> {
  const holder = new Map<string, string>()
  const origins = new Map<string, string>()
  for (const item of items) {
    if (!item.segmentId) continue
    const held = holder.get(item.segmentId)
    if (item.kind === 'boundary' && item.boundary === 'run-started'
        && held !== undefined && held !== item.runId) {
      origins.set(item.eventId, held)
    }
    if (held === undefined) holder.set(item.segmentId, item.runId)
  }
  return origins
}

/* Clearing the current Run (Issue 29). The helper deletes the Run's rows from
   the archive in place, under an intent that refuses every other command
   until the WAL is emptied and the file compacted; links other Runs' entries
   had to the Run go with them. The person sees the scope once and confirms. */
type RunInventory = {
  entries: number
  pending: number
  events: number
  attaches: number
  startedAt: number | null
  unlinked: number
}

function runInventory(value: unknown): RunInventory | null {
  if (value === null) return null
  const count = (field: unknown) => {
    if (!Number.isSafeInteger(field) || (field as number) < 0) throw new Error('clear-inventory')
    return field as number
  }
  if (!isRecord(value)) throw new Error('clear-inventory')
  return {
    entries: count(value.entries),
    pending: count(value.pending),
    events: count(value.events),
    attaches: count(value.attaches),
    startedAt: value.startedAt === null ? null : count(value.startedAt),
    unlinked: count(value.unlinked),
  }
}

/* The files an unfinished Run clear leaves holding what it deleted: a WAL
   not yet emptied, and any migration backup. */
function runResidue(inventory: ClearInventory): { name: string; bytes: number }[] {
  return inventory.files.filter(file =>
    (file.name.endsWith('-wal') && file.bytes > 0) || file.name.includes('.pre-migration-'))
}

function runLeftovers(inventory: ClearInventory): string[] {
  const residue = runResidue(inventory)
  return residue.length > 0
    ? residue.map(file => `${startup.databaseRoot ?? ''}/${file.name}（${file.bytes} 字节）`)
    : ['（没有可列出的残留文件；档案的空间回收或 WAL 清理未完成）']
}

function localTime(at: number): string {
  const date = new Date(at)
  const two = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`
}

/* The person's answer to a Run clear: one confirmation, or a Run clear
   already under way taken up. */
async function askClearRun(
  $: EngineInterface,
  inventory: ClearInventory,
): Promise<'clear' | 'cancelled'> {
  try {
    if (inventory.clearRunUnderway) {
      const answer = await $.ui.ask(
        [
          '之前确认过的一次按 Run 清除尚未完成：记录已不会再被读写，但物理清除未完成，以下残留还在：',
          ...runLeftovers(inventory).map(line => `- ${line}`),
          '清除完成前，本项目的档案不可用。',
        ].join('\n'),
        { header: '继续清除', options: ['继续清除', '取消'] },
      )
      return answer === '继续清除' ? 'clear' : 'cancelled'
    }
    const scope = inventory.run
    if (!scope) return 'cancelled'
    const answer = await $.ui.ask(
      [
        'Prompt Trail 将永久删除当前 Run 的全部记录。',
        `范围：当前 Run 的整条会话谱系，包括它此前所有进程接入（共 ${scope.attaches} 次）中的记录${scope.startedAt === null ? '' : `，最早一条在 ${localTime(scope.startedAt)}`}。`,
        `${scope.entries} 条 Prompt Entry、${scope.pending} 个 Pending Capture、${scope.events} 条边界事件。`,
        ...(scope.unlinked > 0
          ? [`其他 Run 有 ${scope.unlinked} 条记录以本 Run 的条目为父节点；它们会断开这条父链接，成为新的根，内容不变。`]
          : []),
        '其他 Run 的记录保持不变，但其后条目的编号可能前移。Collection consent 与当前 Run 的采集模式不变。',
        CLEAR_BOUNDARY,
      ].join('\n'),
      { header: '清除当前 Run', options: ['清除当前 Run', '取消'] },
    )
    return answer === '清除当前 Run' ? 'clear' : 'cancelled'
  } catch {
    return 'cancelled'
  }
}

type RunCleared = {
  /* False when only continuing, and the clear had finished elsewhere. */
  cleared: boolean
  continued: boolean
  /* Whether the Run cleared is this one: a continuation may finish another's. */
  ownRun: boolean
  entries: number
  pending: number
  events: number
  unlinked: number
  /* Whether the store forgot what it kept of this Run's cleared history. */
  forgotten: boolean
}

/* A new root for a branch whose entry a Run clear took. Only the branch
   this session is on is remembered as its own. */
async function rootAfterRunClear(
  $: EngineInterface,
  branch: { key: string; value: BranchState },
): Promise<{ key: string; value: BranchState }> {
  const root: BranchState = {
    version: 1,
    branchId: crypto.randomUUID(),
    parentEventId: null,
    explicitRoot: true,
    ...(branch.value.generation ? { generation: branch.value.generation } : {}),
  }
  await $.store.set(branch.key, root)
  if (branch.key.endsWith(`:${startup.runId}:${startup.sessionId}`)) rememberBranch(branch.key, root)
  return { key: branch.key, value: root }
}

/* What the store kept about this Run's cleared history goes with it: the
   pending it owed, the lifecycle writes still owed, the Collection Boundary it
   last wrote, and every branch of its sessions, which start new roots.
   Consent and its collection mode stay; other Runs' records are theirs. */
async function forgetClearedRun($: EngineInterface, currentProject: ProjectState): Promise<boolean> {
  const own = startup.runId
  if (!own) return false
  await releaseMarker($, deferredClear?.marker)
  deferredClear = undefined
  transcriptMark = undefined
  if (runMode) runMode = { ...runMode, value: { version: 1, mode: runMode.value.mode } }
  const lifecycleOwn = lifecycleKey(currentProject.id, own)
  if (lifecycle?.key === lifecycleOwn) lifecycle = { key: lifecycleOwn, value: withoutOwed(lifecycle.value) }
  let forgotten = true
  try {
    if (reconcile?.state.runId === own
        || storedReconcile(await $.store.get(reconcileKey(currentProject.id)))?.runId === own) {
      await clearReconcile($, currentProject)
    }
    const branches = `prompt-trail:branch:${currentProject.id}:${own}:`
    for (const key of await $.store.keys()) {
      if (key === lifecycleOwn) {
        await forgetOwedLifecycle($, key)
      } else if (key === runModeKey(currentProject.id, own)) {
        await forgetCollectionBoundary($, key)
      } else if (key.startsWith(branches)) {
        const value = storedBranch(await $.store.get(key))
        if (value) await rootAfterRunClear($, { key, value })
      }
    }
    await forgetMarkers($, currentProject, runOf => runOf === own)
  } catch {
    forgotten = false
  }
  lifecycleFailure = undefined
  return forgotten
}

/* Runs the Run clear the person confirmed, or only finishes one under way.
   Answers what it removed, or the category it stopped at. */
async function clearRun(
  $: EngineInterface,
  currentProject: ProjectState,
  onlyContinue: boolean,
): Promise<RunCleared> {
  if (!startup.helperPath || !startup.databaseRoot || !startup.runId) {
    throw new Error('capture-identity')
  }
  let result: Awaited<ReturnType<typeof runArchive>>
  try {
    result = await runArchive(
      $,
      [
        startup.helperPath,
        'clear-run',
        startup.databaseRoot,
        currentProject.id,
        startup.runId,
        EXPECTED_HELPER_SHA256,
        String(HELPER_PROTOCOL),
        ...(onlyContinue ? ['--continue'] : []),
      ],
      30_000,
    )
    if (result.exitCode !== 0) throw new Error(safeCategory(result.stderr, 'clear-run'))
  } catch (error) {
    /* A Run clear stopped past its cut, whatever stopped it, is unfinished. */
    if (failureCategory(error, 'clear-run') !== 'clear-run-unfinished') {
      let underway = false
      try {
        underway = (await readClearInventory($, currentProject)).clearRunUnderway
      } catch {
        // Not known to be under way; the failure stands as it came.
      }
      if (underway) throw new Error('clear-run-unfinished')
    }
    throw error
  }
  const value: unknown = JSON.parse(result.stdout)
  const counted = (field: unknown) => Number.isSafeInteger(field) && (field as number) >= 0
  if (
    !isRecord(value) ||
    value.projectId !== currentProject.id ||
    typeof value.cleared !== 'boolean' ||
    typeof value.continued !== 'boolean' ||
    typeof value.ownRun !== 'boolean' ||
    ![value.entries, value.pending, value.events, value.unlinked].every(counted)
  ) throw new Error('clear-run')
  let forgotten = true
  if (value.cleared) {
    await archiveRecovered($, currentProject)
    if (value.ownRun) forgotten = await forgetClearedRun($, currentProject)
    /* What the view drew of the cleared Run is read again. */
    resetWindow()
    timelineLoaded = undefined
    $.ui.invalidate('ui.render')
  }
  return {
    cleared: value.cleared,
    continued: value.continued,
    ownRun: value.ownRun,
    entries: value.entries as number,
    pending: value.pending as number,
    events: value.events as number,
    unlinked: value.unlinked as number,
    forgotten,
  }
}

function runClearedText(cleared: RunCleared): string {
  const kept = cleared.forgotten
    ? []
    : ['部分 Prompt Trail 状态未能清理（不含 prompt 原文）；status 可能仍显示旧的 Collection Boundary 或待写边界。']
  if (cleared.continued && !cleared.ownRun) {
    return [
      '之前确认过的按 Run 清除已完成。当前 Run 的记录未清除；如需清除，请再执行一次 /prompt-history clear-run。',
      CLEAR_BOUNDARY,
    ].join('\n')
  }
  return [
    cleared.continued
      ? '之前确认过的当前 Run 清除已完成。'
      : `已清除当前 Run 的 Prompt Trail 记录：${cleared.entries} 条 Prompt Entry、${cleared.pending} 个 Pending Capture、${cleared.events} 条边界事件。`,
    ...(cleared.unlinked > 0 && !cleared.continued
      ? [`其他 Run 的 ${cleared.unlinked} 条记录断开了与本 Run 的父链接，内容不变。`]
      : []),
    '其他 Run 的记录不变，其条目编号可能前移。Collection consent 与当前 Run 的采集模式未改变；下一次提交开始新的根。',
    ...kept,
    CLEAR_BOUNDARY,
  ].join('\n')
}

async function unfinishedRunClearText($: EngineInterface, currentProject: ProjectState): Promise<string> {
  let leftovers = ['（无法列出残留）']
  try {
    leftovers = runLeftovers(await readClearInventory($, currentProject))
  } catch {
    // The listing is best effort; the state it describes is on record.
  }
  return [
    '逻辑删除已完成（被清除的记录不会再被读写），但物理清除未完成；以下残留未能清理：',
    ...leftovers.map(line => `- ${line}`),
    '清除完成前，本项目的档案不可用；可再次执行 /prompt-history clear-run 继续。',
  ].join('\n')
}

function runClearRefusal(category: string): string {
  if (category === 'clear-run-quarantined') return quarantinedRefusal()
  if (category === 'archive-integrity') {
    return 'Prompt Trail 的档案已损坏，无法按 Run 删除，未删除任何内容。请在下一次提交时的档案不可用对话框中处理，或使用 /prompt-history clear-all 清除本项目的全部档案。'
  }
  if (category === 'clear-unfinished') {
    return '本项目的 clear-all 尚未完成，档案不可用；请执行 /prompt-history clear-all 继续，未删除任何内容。'
  }
  return `Prompt Trail 未能开始清除当前 Run（${category}），未删除任何内容。`
}

function quarantinedRefusal(): string {
  return '本项目有隔离档案，Prompt Trail 从不打开它们，无法保证按 Run 完整删除，未删除任何内容。如需删除，请使用 /prompt-history clear-all 清除本项目的全部档案。'
}

async function clearRunCommand($: EngineInterface): Promise<string> {
  if (!runtimeTarget) return 'Prompt Trail 尚未确定运行目标，无法清除当前 Run。'
  await refreshStartup($)
  if (startup.support !== 'supported') {
    return `Prompt Trail 在当前环境不可用（${startup.support}：${startup.reason}），未清除任何内容。`
  }
  if (!startup.runId) return 'Prompt Trail 无法确定当前 Run，未清除任何内容。'
  let currentProject: ProjectState
  let inventory: ClearInventory
  try {
    currentProject = await prepareProject($)
    inventory = await readClearInventory($, currentProject, startup.runId)
  } catch (error) {
    return `Prompt Trail 无法列出当前 Run 的记录（${failureCategory(error, 'clear-inventory')}），未清除任何内容。`
  }
  if (inventory.clearUnderway) return runClearRefusal('clear-unfinished')
  if (!inventory.clearRunUnderway) {
    if (inventory.quarantined.length > 0) return quarantinedRefusal()
    const scope = inventory.run
    if (!scope) return runClearRefusal('archive-integrity')
    if (scope.entries + scope.pending + scope.events === 0) return '当前 Run 没有可清除的 Prompt Trail 记录。'
  }
  if (await askClearRun($, inventory) !== 'clear') return '已取消，未删除任何内容。'
  /* A clear begun here, not one taken up: it is this Run's records. */
  const own = !inventory.clearRunUnderway
  try {
    const cleared = await clearRun($, currentProject, inventory.clearRunUnderway)
    if (!cleared.cleared) {
      await archiveRecovered($, currentProject)
      return '之前的按 Run 清除已由其他 Run 完成，未删除任何新记录。'
    }
    return runClearedText(cleared)
  } catch (error) {
    const category = failureCategory(error, 'clear-run')
    if (category !== 'clear-run-unfinished') {
      if (own && (category === 'helper-call-failed' || category === 'clear-run')
          && await runClearFinished($, currentProject)) {
        return [
          `没有收到清除的回答（${category}），但当前 Run 的记录已不在档案中，清除已完成。`,
          'Collection consent 与当前 Run 的采集模式未改变；下一次提交开始新的根。',
          CLEAR_BOUNDARY,
        ].join('\n')
      }
      return runClearRefusal(category)
    }
    await markUnavailable($, currentProject, category)
    /* Past its cut the Run's records are gone, whoever finishes the clear:
       nothing this Run kept of them may be written back meanwhile. */
    if (own) await forgetClearedRun($, currentProject)
    return unfinishedRunClearText($, currentProject)
  }
}

/* Whether a Run clear whose answer never came finished: no clear under way,
   and nothing of this Run left in the archive. It then forgets what this Run
   kept, as a clear that answered would have. */
async function runClearFinished($: EngineInterface, currentProject: ProjectState): Promise<boolean> {
  try {
    const after = await readClearInventory($, currentProject, startup.runId)
    const scope = after.run
    if (after.clearRunUnderway || !scope || scope.entries + scope.pending + scope.events > 0) return false
  } catch {
    return false
  }
  await forgetClearedRun($, currentProject)
  resetWindow()
  timelineLoaded = undefined
  $.ui.invalidate('ui.render')
  return true
}

/* A held submission's choice to finish a Run clear under way: nothing is
   confirmed again, the person agreed when it began. */
async function continueRunClear($: EngineInterface, failure: Blocked): Promise<boolean> {
  let currentProject: ProjectState
  try {
    currentProject = await prepareProject($)
  } catch {
    return false
  }
  try {
    const cleared = await clearRun($, currentProject, true)
    if (cleared.cleared) $.ui.toast('Prompt Trail 已完成之前确认的按 Run 清除，这次提交继续。')
    else await archiveRecovered($, currentProject)
    return true
  } catch (error) {
    Object.assign(failure, await markUnavailable($, currentProject, failureCategory(error, 'clear-run')))
    return false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    runtimeTarget = {
      isInteractive: e.isInteractive,
      surface: e.surface,
      cwd: e.cwd,
    }
    await $.command.register({
      name: 'prompt-history',
      description: 'Show Prompt Trail or inspect its status',
      argumentHint: '[enable|disable|status]',
      immediate: true,
    })
    try {
      startup = await inspectTarget($, e.isInteractive, e.surface, e.cwd)
    } catch {
      startup = {
        support: 'helper unavailable',
        reason: 'preflight-failed',
        detected: 'target could not be proven',
        projectPath: e.cwd,
      }
    }
    /* A reload fires this again inside the same Run, and the module instance
       it builds starts empty: the band's state and the archived events are
       read back rather than lost. Neither can block the session. */
    if (startup.runId) {
      try {
        const stored: unknown = await $.store.get(uiKey(startup.runId))
        expanded = isRecord(stored) && stored.version === 1 && stored.expanded === true
      } catch {
        // The band starts collapsed, as a new Run's does.
      }
    }
    if (startup.support === 'supported') {
      try {
        const currentProject = await prepareProject($)
        await loadTimeline($, currentProject)
        /* Whether this process already holds its stretch of the Run, so the
           band can tell it from one an earlier process left open. */
        if (currentProject.consent === 'enabled') await loadLifecycle($, currentProject)
      } catch {
        // The band shows what this module instance records from here on.
      }
    }
    /* A reload or a resume replays the transcript's rows before this. */
    queueAlignment($)
    return next(e)
  })

  /* A rewind draws none of the transcript; the one thing it draws is the hint
     line under the prompt box, as the old prompt is put back there. While
     the band is open, that is a moment to ask the transcript again. */
  on('ui.render', { component: 'PromptHint', surface: 'terminal' }, ($, e, next) => {
    if (expanded) queueRecheck($)
    return next(e)
  })

  /* A row the person wrote, drawn by the transcript, is where its Prompt Entry
     can be jumped back to. A preview (`placeholder`) is not a row yet, and a
     row anyone else wrote is not the person's. Drawing archives nothing. */
  on('ui.render', { component: 'UserMessage', surface: 'terminal' }, ($, e, next) => {
    if (
      e.requestId !== 'placeholder' &&
      e.props.origin.kind === 'composer' &&
      recordRow(drawnRows, seenRows, e.requestId, e.props.text)
    ) queueAlignment($)
    return next(e)
  })

  /* Spec §9: a `clear` end cuts a Conversation Segment and an exit ends the
     Run; an in-process `resume` does neither. Every reason goes to the state
     machine, which tells them apart. The event cannot be prevented and its
     result is not this plugin's to change, so the hook writes what it can and
     hands the event on untouched. */
  on('classic.SessionEnd', async ($, e, next) => {
    forgetDrawnRows($)
    await applyLifecycle($, {
      event: 'session-end',
      sessionId: e.session_id,
      reason: e.reason,
    })
    return next(e)
  })

  /* The other half of the same transition: it names the new classic session and
     therefore the new Conversation Segment, and never writes a second boundary.
     `source=compact`, `resume`, `fork` and `startup` reach the state machine as
     events it ignores. */
  on('classic.SessionStart', async ($, e, next) => {
    if (e.source === 'clear') {
      await applyLifecycle($, {
        event: 'session-start',
        sessionId: e.session_id,
        source: e.source,
      })
    }
    return next(e)
  })

  /* Compaction replaces the transcript's earlier rows with a summary, so what
     they proved about the session's lineage is gone for good. The main
     conversation's is marked whatever the Run collects; a precomputed one
     installs nothing yet, and a skipped one changed nothing. */
  on('session.compact', async ($, e, next) => {
    /* Named before the compaction runs, so the mark lands the moment it
       returns rather than after another wait. */
    let sessionId: string | undefined
    if (e.agentId === undefined && e.trigger !== 'precompute') {
      try {
        sessionId = await $.session.id()
      } catch {
        sessionId = undefined
      }
    }
    const result = await next(e)
    if (sessionId !== undefined && result.messages) await markCompacted($, sessionId)
    return result
  })

  on('command.run', { command: 'prompt-history' }, async ($, e) => {
    const args = e.args.trim()
    if (args === '') {
      await refreshStartup($)
      const loaded = project !== undefined && timelineLoaded === project.id
      await ensureTimeline($)
      expanded = true
      await saveExpanded($)
      queueAlignment($)
      /* Opening always shows the latest events. */
      await returnToLatest($, loaded)
      return { text: 'Prompt Trail 已展开。' }
    }
    if (args === 'status') {
      await refreshStartup($)
      /* An unsupported target is reported without resolving the project, so
         status never probes a host Prompt Trail does not run on. A merely
         unhealthy helper still has a real project whose consent and Run mode
         are worth reporting. */
      if (startup.support !== 'unsupported target') {
        try {
          const currentProject = await prepareProject($)
          await loadRunMode($, currentProject)
          await loadLifecycle($, currentProject)
          await foreignLifecycles($, currentProject)
          unsettledCalls = 0
          for (const key of await $.store.keys()) {
            const owner = markerOwner(key, currentProject.id)
            if (owner && owner.runOf === startup.runId && !liveCalls.has(owner.call)) unsettledCalls += 1
          }
          try {
            archiveStatus = undefined
            archiveStatus = await readArchiveStatus($, currentProject)
            if (archiveStatus.clearUnderway) {
              const left = await readClearInventory($, currentProject)
              archiveStatus.clearResidual = left.files.length + left.quarantined.length
            }
            if (archiveStatus.clearRunUnderway) {
              archiveStatus.clearRunResidual = runResidue(await readClearInventory($, currentProject)).length
            }
          } catch {
            // Reported as unknown; the rest of the report stands.
          }
          /* Best effort: a pending this Run has not met yet still blocks it,
             so status says so rather than reading as healthy. A failure here
             never costs the rest of the report. */
          try {
            if (reconcile) {
              pendingElsewhere = undefined
              pendingElsewhere = (await listPending($, currentProject)).skipped
            } else {
              /* Listed afresh, and anything owed is taken up rather than
                 dropped with the count. */
              pendingDiscovered = false
              await discoverPending($, currentProject)
            }
          } catch {
            /* `discoverPending` has already recorded that the archive could
               not be asked, so the report says "unknown" rather than reading
               as healthy; the other lines still stand. */
          }
        } catch {
          // status stays available without a proven project identity.
        }
      }
      return { text: statusText() }
    }
    if (args === 'enable') return { text: await enableCollection($) }
    if (args === 'disable') return { text: await disableCollection($) }
    if (args === 'clear-all') return { text: await clearAllCommand($) }
    if (args === 'clear-run') return { text: await clearRunCommand($) }
    return { text: '用法：/prompt-history [enable|disable|status|clear-run|clear-all]' }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind !== 'composer') return next(e)
    if (!runtimeTarget) return next(e)
    await awaitStartup($)

    /* This call's in-flight marker is cleared only when it finishes. One that
       throws leaves it, and stops being live, so the next submission finds
       what it left. */
    const call = crypto.randomUUID()
    const markers = new Map<string, string>()
    liveCalls.add(call)
    let result: PromptSubmitResult
    try {
      result = await collectSubmission($, e, next, call, markers)
    } catch (error) {
      liveCalls.delete(call)
      throw error
    }
    await removeMarker($, markers.get(call))
    liveCalls.delete(call)
    return result
  })


  /* Closing the Pane without choosing is cancelling: the draft goes back to
     the prompt box once the Pane is gone, and the next submission is judged
     again. While a choice is being saved the Pane stays, so a save that fails
     can still say so there and the draft is not stranded behind it. */
  on('ui.close', async ($, e, next) => {
    const choice = parentChoice
    if (e.id !== PARENT_PANE_ID || e.origin.kind !== 'person' || !choice) return next(e)
    if (choice.settling) return { value: undefined }
    parentChoice = undefined
    const closed = await next(e)
    $.clock.after(0, () => {
      void (async () => {
        const restored = await restoreDraft($, choice.draft)
        $.ui.toast(`Prompt Trail 未确认父节点，${draftNote(restored)}；再次提交时会重新询问。`)
      })()
    })
    return closed
  })

  on('ui.render', { component: 'Pane' }, ($, e, next) => {
    if (e.requestId !== PARENT_PANE_ID) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const choice = parentChoice
    if (!choice) {
      /* Left open by a module instance that has since reloaded: the draft and
         the candidates went with it. */
      $.clock.after(0, () => {
        void $.ui.close({ id: PARENT_PANE_ID }).catch(() => undefined)
      })
      return <Text dimColor>这次父节点确认已失效，请重新提交。</Text>
    }
    const width = Math.max(1, e.props.bodyColumns - 2)
    const answers = [
      ...choice.candidates.map((candidate, index) => ({
        key: `prompt-trail:parent:${index}`,
        label: candidate.label,
        answer: candidate.eventId,
      })),
      { key: 'prompt-trail:parent:root', label: '新根分支', answer: 'root' },
    ]
    return (
      <Box flexDirection="column">
        <Text wrap="wrap">transcript 无法唯一确定下一条 prompt 的父节点，本次提交已阻止。请选择它接在哪条 Prompt Entry 之后，或从新的根分支开始。</Text>
        {answers.map((item, index) => (
          /* The keyed row is what the pointer hovers. */
          <Box key={`${item.key}:row`}>
            <Button
              key={item.key}
              plain
              label={clipCells(item.label, width)}
              hover={{ inverse: true }}
              {...(index === 0 ? { autoFocus: true as const } : {})}
              onPress={() => chooseParent($, choice, item.answer)}
            />
          </Box>
        ))}
        {choice.unlisted > 0 ? (
          <Text dimColor wrap="wrap">{`另有 ${choice.unlisted} 个候选未列出；它们都不对时请选“新根分支”。`}</Text>
        ) : null}
        {choice.error ? <Text color="red" wrap="wrap">{choice.error}</Text> : null}
        <Text dimColor wrap="truncate-end">↑↓ 选择 · Enter 确认 · Esc 取消并放回草稿</Text>
      </Box>
    )
  })

  /* While rows lie below the view, the band's tree is taller than the
     engine's window, so the engine hands the person's wheel, trackpad and
     scroll keys here, arrows included, instead of moving the ring itself.
     The window is never passed on and stays at offset 0 under the title; the
     band's own view moves instead, and an arrow key (a step of one row, no
     pointer) while the ring is on the band walks the ring. */
  on('ui.scroll', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.origin.kind !== 'person' || !expanded || dialogs > 0 || surveyHeld) return next(e)
    const arrow = e.pointer === undefined && Math.abs(e.by) === 1
    if (arrow && ringKey !== undefined
        && (ringKey === TITLE_KEY || bandView.stops.includes(ringKey))) {
      await stepRing($, e.by as 1 | -1)
    } else {
      await scrollView($, e.by)
    }
    return {}
  })

  /* While the tree fits (the band resting at the window's end), the engine
     walks the ring itself and wraps it at both ends. The band takes the
     moves that leave the rows shown: up off the first row, or from the title
     round to the last row, moves the view up; down from the last row round
     to the title goes on only to a later batch. A click or Tab can still
     land the ring on the window's end row, which fetches ahead. */
  on('ui.focus', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (dialogs > 0 || surveyHeld) return next(e)
    if (e.origin.kind === 'person' && expanded && bandView.fits && ringKey !== undefined) {
      const showing = bandView.stops.filter(key => bandView.shown.includes(key))
      const hiddenAbove = bandView.shown[0] !== bandView.rowKeys[0] || timelineEdges.earlier
      const onTitle = e.element === TITLE_KEY || e.element === EARLIER_HINT_KEY
      if (hiddenAbove && onTitle && ringKey === showing[0]) {
        await stepRing($, -1)
        return {}
      }
      if (ringKey === TITLE_KEY && e.element === showing.at(-1)) {
        if (!hiddenAbove) return { deny: 'the band does not wrap' }
        await scrollView($, -1)
        return {}
      }
      if (ringKey === showing.at(-1) && e.element === TITLE_KEY) {
        if (!timelineEdges.later) return { deny: 'the band does not wrap' }
        await stepRing($, 1)
        return {}
      }
    }
    const result = await next(e)
    if (result.deny) return result
    ringKey = e.element
    if (e.origin.kind === 'person' && e.element !== undefined) {
      if (e.element === bandView.stops[0] && timelineEdges.earlier) await extendWindow($, 'earlier')
      else if (e.element === bandView.stops.at(-1) && timelineEdges.later) await extendWindow($, 'later')
    }
    return result
  })

  /* An AskUserQuestion dialog, the model's or this plugin's own, takes the
     slot above the prompt for as long as it is up, the survey its host flag
     does not report; the band returns as it was once the call settles. */
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    dialogs += 1
    $.ui.invalidate('ui.render')
    try {
      return await next(e)
    } finally {
      dialogs -= 1
      $.ui.invalidate('ui.render')
    }
  })

  on('ui.render', { component: 'AbovePrompt', surface: 'terminal' }, ($, e, next) => {
    surveyHeld = e.props.hasSurvey
    if (dialogs > 0 || surveyHeld) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    bandView.requestId = e.requestId
    const toggle = async () => {
      expanded = !expanded
      $.ui.invalidate('ui.render')
      await saveExpanded($)
      if (!expanded) return
      /* Whatever was rewound or cleared while it was folded is marked as the
         band opens. */
      queueAlignment($)
      const loaded = project !== undefined && timelineLoaded === project.id
      if (startup.support !== 'supported' || timelineLoaded === undefined) {
        await refreshStartup($)
        await ensureTimeline($)
      }
      /* Opening always shows the latest events. */
      await returnToLatest($, loaded)
    }
    const unavailableShown = archiveFailure !== undefined
      && project?.consent === 'enabled'
      && runMode?.value.mode !== 'disabled'
    if (!expanded) {
      return (
        <Button
          key="prompt-trail:toggle"
          plain
          label={unavailableShown ? `▸ Prompt Trail · ${UNAVAILABLE_MARK}` : '▸ Prompt Trail'}
          onPress={toggle}
        />
      )
    }
    /* Too small for its rows, the band keeps only its title, which still
       folds it; the window, the view and the count wait for room. */
    if (e.props.bodyColumns < 28 || e.props.maxRows < 6) {
      if (!cramped) crampedRing = ringKey
      cramped = true
      return <Button key="prompt-trail:toggle" plain label="▾ Prompt Trail · 空间不足" onPress={toggle} />
    }
    if (cramped) {
      cramped = false
      if (crampedRing !== undefined && crampedRing !== TITLE_KEY) pendingFocus ??= crampedRing
      crampedRing = undefined
    }
    queueRecheck($)
    const rows = bandRows()
    const stops = stopKeys(rows)
    const width = Math.max(1, e.props.bodyColumns)
    /* The view: as many rows as fit under the title (and the new-entry row),
       resting on the last row while it follows, else where its first row
       was, moved just enough to show a row the ring is headed for. A view
       with rows below it draws a blank row for each, so the tree is taller
       than the band and the engine hands the person's scrolling here, the
       blanks under the engine's `n more` row. One reaching the window's end
       draws none: the tree fits, with a row more than a scrolling view has
       room for, and the engine counts nothing below it. */
    const layout = (hint: boolean) => {
      const capacity = Math.max(1, e.props.maxRows - 2 - (hint ? 1 : 0))
      const last = Math.max(0, rows.length - capacity)
      const anchored = bandAnchor === undefined ? -1 : rows.findIndex(row => row.key === bandAnchor)
      let top = bandBottom ? last : Math.min(Math.max(anchored >= 0 ? anchored : bandTop, 0), last)
      const heading = pendingFocus === undefined ? -1 : rows.findIndex(row => row.key === pendingFocus)
      if (heading >= 0 && heading < top) top = heading
      if (heading >= top + capacity) top = heading - capacity + 1
      const fits = rows.length - top <= capacity + 1
      if (fits) top = Math.max(0, rows.length - capacity - 1)
      return {
        capacity,
        top,
        size: fits ? capacity + 1 : capacity,
        fits,
        bottom: !timelineEdges.later && fits,
      }
    }
    let view = layout(unread > 0)
    if (view.bottom && unread > 0) {
      unread = 0
      view = layout(false)
    }
    bandTop = view.top
    bandAnchor = rows[view.top]?.key
    bandBottom = view.bottom
    const shown = rows.slice(view.top, view.top + view.size)
    const shownKeys = shown.map(row => row.key)
    bandView = {
      requestId: e.requestId,
      rowKeys: rows.map(row => row.key),
      stops,
      capacity: view.capacity,
      shown: shownKeys,
      fits: view.fits,
    }
    /* A ring whose row the view scrolled away follows it onto the nearest
       row still shown. */
    if (pendingFocus === undefined && ringKey !== undefined && stops.includes(ringKey)
        && !shownKeys.includes(ringKey)) {
      const above = rows.findIndex(row => row.key === ringKey) < view.top
      const showing = stops.filter(key => shownKeys.includes(key))
      pendingFocus = above ? showing[0] : showing.at(-1)
    }
    const focusTo = pendingFocus !== undefined && shownKeys.includes(pendingFocus) ? pendingFocus : undefined
    if (focusTo !== undefined) {
      pendingFocus = undefined
      $.clock.after(0, () => {
        void $.ui.focus({ requestId: e.requestId, key: focusTo }).then(
          moved => { if (!moved.deny) ringKey = focusTo },
          () => undefined,
        )
      })
    }
    const lastShownStop = stops.filter(key => shownKeys.includes(key)).at(-1)
    const below = rows.length - view.top - shown.length
    /* The title row: while rows lie above the view, a click that takes it up
       a page (resting at the window's end the engine sends the band no
       scrolling at all, so it says so); then how to give the band the
       keyboard, which reads true whoever holds it now. The hint goes whole
       or not at all, before the way up is cut. */
    const upLabel = view.top > 0 || timelineEdges.earlier
      ? (view.fits ? '↑ 点此向上浏览 · 底部不响应触控板' : '↑ 点此向上浏览')
      : undefined
    /* A count crowding out the way up leaves the title: it still shows on the
       row that takes the view back down. */
    let title = unread > 0 ? `▾ Prompt Trail · ${unread} 条新条目` : '▾ Prompt Trail'
    if (upLabel !== undefined && width - textCells(title) < 2 + UP_MIN_CELLS) title = '▾ Prompt Trail'
    title = clipCells(title, width)
    let room = width - textCells(title)
    const up = upLabel === undefined || room < 2 + UP_MIN_CELLS ? undefined : clipCells(upLabel, room - 2)
    if (up !== undefined) room -= 2 + textCells(up)
    const focusHint = stops.length > 0 && room >= 2 + textCells(FOCUS_HINT)
    if (focusHint) room -= 2 + textCells(FOCUS_HINT)
    /* The first thing a narrow row gives up: status still says it. */
    const mark = unavailableShown && room >= 2 + textCells(UNAVAILABLE_MARK)
    return (
      <Box flexDirection="column">
        {up !== undefined || focusHint || mark ? (
          <Box flexDirection="row" gap={2}>
            <Button key="prompt-trail:toggle" plain label={title} onPress={toggle} />
            {up !== undefined ? (
              <Button key={EARLIER_HINT_KEY} plain dimColor label={up} onPress={() => pageUp($)} />
            ) : null}
            {focusHint ? <Text dimColor>{FOCUS_HINT}</Text> : null}
            {mark ? <Text color="yellow">{UNAVAILABLE_MARK}</Text> : null}
          </Box>
        ) : (
          <Button key="prompt-trail:toggle" plain label={title} onPress={toggle} />
        )}
        {rows.length === 0 ? (
          <Text dimColor>尚无 Prompt Entry</Text>
        ) : shown.map(row => row.fold !== undefined ? (
          <Button
            key={row.key}
            plain
            label={clipCells(row.text, width)}
            onPress={() => {
              const fold = row.fold as string
              if (openFolds.has(fold)) openFolds.delete(fold)
              else openFolds.add(fold)
              $.ui.invalidate('ui.render')
            }}
          />
        ) : row.entry ? (
          /* A Prompt Entry is a stop for the ring, activated to jump back to
             its row. Taking the band's keyboard starts on the latest one
             shown. */
          <Button
            key={row.key}
            plain
            label={clipCells(row.text, width)}
            {...(row.dim ? { dimColor: true } : {})}
            {...(row.key === lastShownStop ? { autoFocus: true as const } : {})}
            onPress={() => {
              if (row.eventId !== undefined) void jumpTo($, row.eventId)
              if (row.key === 'prompt-trail:earlier') void extendWindow($, 'earlier')
              if (row.key === 'prompt-trail:later') void extendWindow($, 'later')
            }}
          />
        ) : (
          <Text
            key={row.key}
            wrap="truncate-end"
            {...(row.dim ? { dimColor: true } : {})}
            {...(row.warn ? { color: 'yellow' } : {})}
          >
            {row.text}
          </Text>
        ))}
        {unread > 0 ? (
          <Button
            key="prompt-trail:latest"
            plain
            label={`↓ ${unread} 条新条目`}
            onPress={() => returnToLatest($)}
          />
        ) : null}
        {Array.from({ length: below }, (_, index) => (
          <Text key={`prompt-trail:below:${index}`}> </Text>
        ))}
      </Box>
    )
  })
}
