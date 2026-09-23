import type { EngineInterface, Register, SessionMessage } from 'claude-code'
import { EXPECTED_HELPER_SHA256, HELPER_PROTOCOL } from './artifact'
import type { BranchMatch, BranchState, TranscriptMark } from './branch'
import {
  branchStarts,
  chooseBranch,
  foldTimeline,
  forkSources,
  markTranscript,
  settleBranch,
  transcriptKept,
  transcriptRows,
  trustsStoredBranch,
} from './branch'
import type {
  Attachment,
  LifecycleEvent,
  LifecycleState,
  LifecycleWrite,
} from './lifecycle'
import {
  LIFECYCLE_QUEUE_CAPACITY,
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
   appeared, or where a process took it up again or left it. They share the
   table, the project-level sequence and the drawing of one dim row, and
   nothing else. */
type BoundaryKind =
  | CollectionBoundaryKind
  | 'clear'
  | 'run-started'
  | 'run-attached'
  | 'run-detached'

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
const LOCATOR_SUFFIX = '.claude/plugins/data/.function-hook-locators/prompt-trail'
const SAFE_IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/
const SAFE_ERROR_CATEGORIES = new Set([
  'architecture',
  'archive-sqlite',
  'boundary-conflict',
  'boundary-input',
  'capture-conflict',
  'capture-input',
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
  'operating-system',
  'operating-system-unproven',
  'plugin-artifacts-untrusted',
  'plugin-bin-untrusted',
  'plugin-data-permissions',
  'plugin-root-untrusted',
  'project-identity',
  'protocol-mismatch',
  'schema-version',
  'sqlite-capability',
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
let timeline: TimelineItem[] = []
let archiveUnavailable = false
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
let pendingUnknown = false
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
let deferredClear: { sessionId: string; occurredAt: number } | undefined
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
let timelineLoaded: string | undefined
let locatorAwaited: string | undefined
/* The current session's Active Branch as last read or written, which is what
   the band folds against; and the branches that began from a root because a
   fork's shared history matched several lineages. Both only shape the view. */
let activeBranch: { key: string; value: BranchState } | undefined
const ambiguousRoots = new Set<string>()
/* The folds the person opened, by the entry each is drawn at. */
const openFolds = new Set<string>()
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
    ) return parsed.category
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
        || !SAFE_IDENTIFIER.test(locator.archiveGeneration)) {
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
  }
}

/* A queued lifecycle write is replayed verbatim into `boundary-append`, where
   a single changed field fails the whole retry as `boundary-conflict`. So the
   record is accepted only when every field it will replay is intact; a damaged
   one is dropped rather than retried into a permanent refusal. */
function storedLifecycleWrite(value: unknown): LifecycleWrite | undefined {
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
  const leaving = value.leaving === undefined ? undefined : storedLifecycleWrite(value.leaving)
  return {
    id: value.id,
    host: value.host,
    segmentId: value.segmentId,
    ...(value.closed === true ? { closed: true as const } : {}),
    ...(leaving?.kind === 'run-detached' ? { leaving } : {}),
  }
}

function storedLifecycle(value: unknown): LifecycleState | undefined {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.queue)) {
    return undefined
  }
  const queue: LifecycleWrite[] = []
  let damaged = value.damaged === true
  for (const row of value.queue.slice(0, LIFECYCLE_QUEUE_CAPACITY)) {
    const write = storedLifecycleWrite(row)
    if (write) queue.push(write)
    /* Replaying a row whose fields no longer hold would fail as a
       `boundary-conflict` forever, so it is dropped — and the loss recorded,
       because a lifecycle fact that cannot be written is a gap, not a no-op. */
    else damaged = true
  }
  if (value.queue.length > LIFECYCLE_QUEUE_CAPACITY) damaged = true
  const clear = storedClearTransition(value.clear)
  const attachment = storedAttachment(value.attachment)
  return {
    version: 1,
    queue,
    ...(clear ? { clear } : {}),
    ...(value.unobservedClear === true ? { unobservedClear: true as const } : {}),
    ...(value.overflowed === true ? { overflowed: true as const } : {}),
    ...(damaged ? { damaged: true as const } : {}),
    ...(value.started === true ? { started: true as const } : {}),
    ...(attachment ? { attachment } : {}),
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
    value = storedLifecycle(await $.store.get(key)) ?? emptyLifecycle()
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
  lifecycle = { key, value }
  await $.store.set(key, value)
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
    const value = storedLifecycle(await $.store.get(key))
    if (value) found.push({ key, value })
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
  const result = await run(
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
  return { eventId, sequence }
}

async function canonicalProjectRoot(
  $: EngineInterface,
  cwd: string,
): Promise<string> {
  const canonicalCwd = await realpath($, cwd)
  let candidate = canonicalCwd
  const git = await run(
    $,
    ['/usr/bin/git', '-C', canonicalCwd, 'rev-parse', '--show-toplevel'],
  )
  if (git.exitCode === 0) {
    const root = git.stdout.trim()
    if (!root.startsWith('/') || /[\u0000-\u001f\u007f]/.test(root)) {
      throw new Error('project-root-unproven')
    }
    candidate = root
  } else {
    if (git.exitCode !== 128) throw new Error('project-root-unproven')
    let directory = canonicalCwd
    for (;;) {
      if (await $.fs.exists(`${directory}/.git`)) {
        throw new Error('project-root-unproven')
      }
      const slash = directory.lastIndexOf('/')
      if (slash <= 0) break
      directory = directory.slice(0, slash)
    }
  }
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
    return project
  }
  const consent = storedConsent(await $.store.get(consentKey(id)))
  let blocked = false
  let owed: ReconcileState | undefined
  try {
    const archiveState = await $.store.get(archiveStateKey(id))
    blocked = isRecord(archiveState)
      && archiveState.version === 1
      && archiveState.state === 'unavailable'
    owed = storedReconcile(await $.store.get(reconcileKey(id)))
  } catch {
    /* Not knowing whether something is owed is itself a reason to stop, so an
       unreadable record fails closed exactly as an unreadable archive does. */
    blocked = consent === 'enabled'
  }
  archiveUnavailable = blocked
  reconcile = owed ? { state: owed } : undefined
  pendingDiscovered = false
  pendingUnknown = false
  runMode = undefined
  /* The lifecycle record is keyed by Run, so it is read once the Run is proven
     rather than here. Left unset, status reports it as unknown rather than as
     an empty queue. */
  lifecycle = undefined
  deferredClear = undefined
  /* The band shows one Project Timeline: another project's rows, read back or
     recorded here, are not this one's to draw. */
  timeline = []
  timelineLoaded = undefined
  project = {
    root,
    id,
    databasePath,
    consent,
    archiveReady: false,
  }
  startup.projectPath = root
  return project
}

async function markArchiveUnavailable(
  $: EngineInterface,
  currentProject: ProjectState,
): Promise<void> {
  archiveUnavailable = true
  try {
    await $.store.set(archiveStateKey(currentProject.id), {
      version: 1,
      state: 'unavailable',
    })
  } catch {
    // The in-memory block remains active for this module instance.
  }
}

async function requestConsent(
  $: EngineInterface,
  currentProject: ProjectState,
): Promise<ConsentDecision | undefined> {
  if (currentProject.consent) return currentProject.consent
  if (!currentProject.databasePath) throw new Error('database-root-unavailable')
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
  /* The archive has just become this plugin's to look into, and it may already
     hold what an earlier consent recorded. */
  if (decision === 'enabled') {
    try {
      await loadTimeline($, currentProject)
    } catch {
      // The band shows what this module instance records from here on.
    }
  }
  return decision
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
  const value: BranchState = {
    version: 1,
    branchId: crypto.randomUUID(),
    parentEventId: null,
  }
  await $.store.set(key, value)
  return { key, value }
}

function parsePendingResponse(
  text: string,
  eventId: string,
  projectId: string,
): void {
  const value: unknown = JSON.parse(text)
  if (
    !isRecord(value) ||
    value.eventId !== eventId ||
    value.projectId !== projectId ||
    value.pending !== true
  ) throw new Error('capture-response')
}

function parseConfirmedResponse(
  text: string,
  eventId: string,
  projectId: string,
): number {
  const value: unknown = JSON.parse(text)
  if (
    !isRecord(value) ||
    value.eventId !== eventId ||
    value.projectId !== projectId ||
    !Number.isSafeInteger(value.sequence) ||
    (value.sequence as number) < 1
  ) throw new Error('capture-response')
  return value.sequence as number
}

async function beginCapture(
  $: EngineInterface,
  currentProject: ProjectState,
  branch: BranchState,
  eventId: string,
  occurredAt: number,
  text: string,
  attachmentKinds: readonly string[],
): Promise<void> {
  if (!startup.helperPath || !startup.databaseRoot || !startup.runId || !startup.sessionId) {
    throw new Error('capture-identity')
  }
  const result = await run(
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
      EXPECTED_HELPER_SHA256,
      String(HELPER_PROTOCOL),
      '--stdin',
    ],
    10_000,
    text,
  )
  if (result.exitCode !== 0) throw new Error('capture-begin')
  parsePendingResponse(result.stdout, eventId, currentProject.id)
  currentProject.archiveReady = true
}

/* `text` is the text `next(e)` returned. Without it — a reconciliation after a
   restart, where the draft is gone — the helper archives the bytes it already
   staged, which never leave it. */
async function confirmCapture(
  $: EngineInterface,
  currentProject: ProjectState,
  eventId: string,
  text: string | undefined,
): Promise<number> {
  if (!startup.helperPath || !startup.databaseRoot) {
    throw new Error('capture-identity')
  }
  const result = await run(
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
  if (result.exitCode !== 0) throw new Error('capture-confirm')
  return parseConfirmedResponse(result.stdout, eventId, currentProject.id)
}

function parsePendingList(text: string, projectId: string): ReconcileState[] {
  const value: unknown = JSON.parse(text)
  if (
    !isRecord(value) ||
    value.projectId !== projectId ||
    !Array.isArray(value.pending)
  ) throw new Error('capture-list')
  const owed: ReconcileState[] = []
  for (const row of value.pending) {
    const state = storedReconcile(isRecord(row) ? { ...row, version: 1 } : undefined)
    if (!state) throw new Error('capture-list')
    owed.push(state)
  }
  return owed
}

/* What the archive still holds unresolved. It is the only way a new process
   learns that a previous one left a Pending Capture behind — its `$.store`
   record may never have been written. */
async function listPending(
  $: EngineInterface,
  currentProject: ProjectState,
): Promise<ReconcileState[]> {
  if (!startup.helperPath || !startup.databaseRoot) {
    throw new Error('capture-identity')
  }
  const result = await run(
    $,
    [
      startup.helperPath,
      'capture-list',
      startup.databaseRoot,
      currentProject.id,
      EXPECTED_HELPER_SHA256,
      String(HELPER_PROTOCOL),
    ],
    10_000,
  )
  if (result.exitCode !== 0) throw new Error('capture-list')
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
])

/* What an archive written before a Run became a conversation's lineage called
   a process leaving it. */
const LEGACY_KINDS = new Map<string, BoundaryKind>([['run-ended', 'run-detached']])

/* A response that is not exactly the shape the helper writes is refused
   whole: a row that cannot be trusted is not drawn as history. */
function parseTimeline(text: string, projectId: string): TimelineItem[] {
  const value: unknown = JSON.parse(text)
  if (
    !isRecord(value) ||
    value.projectId !== projectId ||
    !Array.isArray(value.events) ||
    typeof value.truncated !== 'boolean'
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
        (row.attachmentCount as number) < 0
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
      }
    }
    const kind = typeof row.kind === 'string' ? LEGACY_KINDS.get(row.kind) ?? row.kind : undefined
    if (kind === undefined || !TIMELINE_KINDS.has(kind)) throw new Error('timeline-read')
    return { kind: 'boundary', ...identity, boundary: kind as BoundaryKind }
  })
}

/* The latest events of the Project Timeline, read back so a reload or a new
   process shows what the archive already holds. The helper fixes the batch;
   reading further back is Issue 21's. Rows this module instance already
   appended are kept, and nothing is drawn twice. Read only with consent: before
   it the archive is not this plugin's to look into. */
async function loadTimeline(
  $: EngineInterface,
  currentProject: ProjectState,
): Promise<void> {
  if (currentProject.consent !== 'enabled' || !startup.helperPath || !startup.databaseRoot) {
    return
  }
  const result = await run(
    $,
    [
      startup.helperPath,
      'timeline-read',
      startup.databaseRoot,
      currentProject.id,
      EXPECTED_HELPER_SHA256,
      String(HELPER_PROTOCOL),
    ],
    10_000,
  )
  if (result.exitCode !== 0) throw new Error('timeline-read')
  const persisted = parseTimeline(result.stdout, currentProject.id)
  const known = new Set(persisted.map(item => item.eventId))
  timeline = [...persisted, ...timeline.filter(item => !known.has(item.eventId))]
    .sort((left, right) => left.sequence - right.sequence)
  timelineLoaded = currentProject.id
  try {
    await loadBranchView($, currentProject)
  } catch {
    // Without it the band draws every entry unfolded, which hides nothing.
  }
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
  const result = await run(
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
  if (result.exitCode !== 0) throw new Error('capture-abort')
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
      const sequence = await confirmCapture(
        $,
        currentProject,
        owed.state.eventId,
        owed.text,
      )
      /* Only the Run that staged it may chain its own Active Branch onto the
         entry; another Run's branch is not this reconciliation's to move. */
      if (startup.runId === owed.state.runId && startup.sessionId) {
        const key = branchKey(currentProject.id, startup.runId, startup.sessionId)
        const confirmed: BranchState = {
          version: 1,
          branchId: owed.state.branchId,
          parentEventId: owed.state.eventId,
        }
        await $.store.set(key, confirmed)
        rememberBranch(key, confirmed)
      }
      if (owed.text !== undefined) {
        timeline = [
          ...timeline,
          {
            kind: 'prompt',
            eventId: owed.state.eventId,
            sequence,
            runId: owed.state.runId,
            branchId: owed.state.branchId,
            parentEventId: owed.state.parentEventId,
            text: owed.text,
            attachmentCount: owed.state.attachmentCount,
          },
        ]
        $.ui.invalidate('ui.render')
      }
      await clearReconcile($, currentProject)
      return 'resolved'
    } catch {
      return 'blocked'
    }
  }

  const discardPending = async (): Promise<'resolved' | 'blocked'> => {
    try {
      await abortCapture($, currentProject, owed.state.eventId)
      await clearReconcile($, currentProject)
      return 'resolved'
    } catch {
      return 'blocked'
    }
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
    owed = await listPending($, currentProject)
  } catch (error) {
    pendingUnknown = true
    throw error
  }
  pendingDiscovered = true
  pendingUnknown = false
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
      !Number.isSafeInteger(candidate.sequence)
    ) throw new Error('branch-match')
    return {
      eventId: candidate.eventId,
      runId: candidate.runId,
      sequence: candidate.sequence as number,
    }
  })
  const candidateCount = value.candidateCount as number
  if (value.match === 'unique' && isSafeId(value.eventId)) {
    return { match: 'unique', eventId: value.eventId, candidates, candidateCount }
  }
  if (value.match === 'none' || value.match === 'ambiguous') {
    return { match: value.match, candidates, candidateCount }
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
  if (!startup.helperPath || !startup.databaseRoot || !startup.runId || !startup.sessionId) {
    throw new Error('capture-identity')
  }
  const rows = transcriptRows(messages)
  const scoped = stored?.parentEventId != null
  const result = await run(
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
    ],
    10_000,
    rows.stdin,
  )
  if (result.exitCode !== 0) throw new Error('branch-match')
  return parseBranchMatch(result.stdout, currentProject.id)
}

/* How a candidate parent is offered: by its sequence and a single line of its
   text while the loaded window holds it, by its event id otherwise. */
const PARENT_LABEL_WIDTH = 40

function parentLabel(eventId: string, found: BranchMatch): string {
  const entry = timeline.find(item => item.kind === 'prompt' && item.eventId === eventId)
  if (entry?.kind === 'prompt') {
    const line = entryLine(entry)
    const text = line.length > PARENT_LABEL_WIDTH ? `${line.slice(0, PARENT_LABEL_WIDTH - 1)}…` : line
    return `#${entry.sequence} ${text}`
  }
  const candidate = found.candidates.find(item => item.eventId === eventId)
  return candidate
    ? `#${candidate.sequence} 事件 ${eventId.slice(0, 8)}`
    : `事件 ${eventId.slice(0, 8)}`
}

/* The engine's dialog offers at most four answers: three parents and a root. */
const PARENT_OPTION_LIMIT = 3

/* Settles this session's Active Branch against its transcript before every
   capture: in full the first time this module instance meets the session,
   and after that whenever the transcript no longer holds the last captured
   prompt where it landed, which is what a rewind leaves. Answers a result
   that drops the submission, or the transcript it was settled against. A
   stored lineage the transcript cannot place is put to the person; the
   submission is dropped either way, with the draft back in the prompt box,
   and never resubmitted. */
async function alignBranch(
  $: EngineInterface,
  currentProject: ProjectState,
  draft: string,
): Promise<{ drop: string } | { messages: readonly SessionMessage[] }> {
  if (!startup.runId || !startup.sessionId) {
    return { drop: 'Prompt Trail 无法证明当前 Run 身份；本次提交未进入会话。' }
  }
  const key = branchKey(currentProject.id, startup.runId, startup.sessionId)
  const blocked = async () => ({
    drop: `Prompt Trail 无法重建 Conversation Branch，${draftNote(await restoreDraft($, draft))}；为避免挂错父节点，本次提交已阻止。`,
  })
  let messages: readonly SessionMessage[]
  try {
    messages = await $.session.messages()
  } catch {
    return blocked()
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
    settlement = settleBranch(stored, found, crypto.randomUUID(), compacted)
    if (settlement.kind === 'set') {
      await $.store.set(key, settlement.state)
      rememberBranch(key, settlement.state)
    } else if (settlement.kind === 'keep' && stored) {
      rememberBranch(key, stored)
    }
  } catch {
    return blocked()
  }
  if (settlement.kind !== 'ask') {
    settled()
    return { messages }
  }

  const offered = settlement.options.slice(0, PARENT_OPTION_LIMIT)
  const labels = offered.map(eventId => parentLabel(eventId, found))
  /* What the dialog leaves out, plus what the helper counted but never named. */
  const unlisted = settlement.options.length - offered.length
    + Math.max(0, found.candidateCount - found.candidates.length)
  let answer: string | undefined
  try {
    answer = await $.ui.ask(
      [
        '这个会话的 transcript 与 Prompt Trail 记录的 Active Branch 对不上，无法唯一确定下一条 prompt 的父节点。',
        '请选择它接在哪条 Prompt Entry 之后，或从新的根 Conversation Branch 开始。',
        ...(unlisted > 0 ? [`另有 ${unlisted} 个候选未列出；它们都不对时请选“新根分支”。`] : []),
        '选择后本次提交不会自动重发。',
      ].join('\n'),
      { header: '确认父节点', options: [...labels, '新根分支'] },
    )
  } catch {
    answer = undefined
  }
  const chosen = answer === '新根分支'
    ? 'root'
    : offered[labels.indexOf(answer ?? '')]
  const restoredNote = async () => draftNote(await restoreDraft($, draft))
  if (answer === undefined || chosen === undefined) {
    return {
      drop: `Prompt Trail 仍待确认 Conversation Branch 父节点，${await restoredNote()}；本次提交未进入会话。`,
    }
  }
  try {
    const chosenBranch = chooseBranch(stored, chosen, crypto.randomUUID())
    await $.store.set(key, chosenBranch)
    rememberBranch(key, chosenBranch)
  } catch {
    return {
      drop: `Prompt Trail 无法保存所选父节点，${await restoredNote()}；本次提交未进入会话。`,
    }
  }
  settled()
  return {
    drop: `Prompt Trail 已确认 Conversation Branch 父节点，${await restoredNote()}；请重新提交。`,
  }
}

async function sessionCompacted(
  $: EngineInterface,
  projectId: string,
  sessionId: string,
): Promise<boolean> {
  const key = compactedKey(projectId, sessionId)
  if ((await $.store.get(key)) === true) return true
  if (!compactedSessions.has(sessionId)) return false
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
      await $.store.set(record.key, decision.state)
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
    try {
      await writeBoundary($, currentProject, write)
    } catch {
      break
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
  for (const record of foreign) {
    if (record.value.queue.length === 0) continue
    let settled = record.value
    for (const write of record.value.queue) {
      try {
        await writeBoundary($, currentProject, write)
      } catch {
        break
      }
      settled = dequeueLifecycleWrite(settled, write.eventId)
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
    if (settled.queue.length > 0) settledAll = false
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
  const defer = async () => {
    if (!isClearEnd || deferredClear) return
    try {
      deferredClear = { sessionId: input.sessionId, occurredAt: await $.clock.now() }
    } catch {
      deferredClear = { sessionId: input.sessionId, occurredAt: 0 }
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
    await defer()
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
      await defer()
      return
    }
    if (mode.mode === 'disabled') return
  }

  /* A `/clear` is a write of this Run, so this process's attachment is opened
     ahead of it. Leaving never opens one: a process that archived nothing has
     nothing to leave. */
  if (isClearEnd && !await ensureRunAttached($, currentProject, input.sessionId)) {
    await defer()
    return
  }

  let state: LifecycleState
  try {
    state = await loadLifecycle($, currentProject)
  } catch {
    await defer()
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
      await defer()
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
    await defer()
    return
  }

  if (decision.write) {
    /* Owed first, attempted second. */
    const queued = queueLifecycleWrite(decision.state, decision.write)
    try {
      await saveLifecycle($, currentProject, queued)
    } catch {
      await defer()
      return
    }
    if (isClearEnd) deferredClear = undefined
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
      },
    )
    recordBoundary(write.kind, appended, write.runId, write.segmentId)
    lifecycleFailure = undefined
    $.ui.invalidate('ui.render')
  } catch (error) {
    lifecycleFailure = error instanceof Error && SAFE_ERROR_CATEGORIES.has(error.message)
      ? error.message
      : 'boundary-append'
    throw error
  }
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
      }
      const state = await loadLifecycle($, currentProject)
      await saveLifecycle($, currentProject, queueLifecycleWrite(state, write))
      deferredClear = undefined
    } catch {
      return 'blocked'
    }
  }

  /* Another Run's debts first: they are facts of a process that has already
     gone, and this Run's own start is not ordered ahead of them. */
  const foreignSettled = await flushForeignLifecycles($, currentProject)
  const ownSettled = await flushOwnLifecycle($, currentProject)
  return foreignSettled && ownSettled ? 'clear' : 'blocked'
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
  if (kind === 'run-detached') return '—— Run 离开 ——'
  /* Drawn, never archived: the archive cannot tell a process that crashed from
     one still running elsewhere, and this claims only what it knows. */
  if (kind === 'run-unclosed') return '—— Run 未记录离开 ——'
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
  if (reconcile) return `${reconcile.state.eventId.slice(0, 8)} · 待对账`
  if (pendingUnknown) return 'unknown · 未决 Pending Capture 不可读'
  return 'none'
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
  if (state.unobservedClear) parts.push('观察到无对应 SessionEnd 的 source=clear')
  if (state.queue.length > 0) {
    parts.push(owedText(state.queue))
    if (lifecycleFailure) parts.push(`上次补写失败：${statusValue(lifecycleFailure)}`)
  }
  if (state.overflowed) parts.push('恢复队列已溢出，部分 Clear Boundary 未记录')
  if (state.damaged) parts.push('恢复队列有无法重放的记录，其 Clear Boundary 或 Run 边界已丢失')
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
  if (pendingUnknown) return 'unknown · 未决 Pending Capture 不可读'
  if (!lifecycle) return 'unknown · lifecycle 记录不可读'
  if (deferredClear) return 'disabled · 已观察到 /clear 但尚未记录'
  const owed = [...lifecycle.value.queue, ...lifecycleOthers?.queue ?? []]
  if (owed.length > 0) {
    return owed.some(write => write.kind === 'clear')
      ? 'disabled · Clear Boundary 待补写'
      : 'disabled · Run 边界待补写'
  }
  if (archiveUnavailable) return 'disabled · 档案不可用'
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
  const archive = archiveUnavailable
    ? 'unavailable'
    : project?.archiveReady && project.databasePath
      ? `ready · ${statusValue(project.databasePath)}`
      : 'not created'
  return [
    'Prompt Trail status',
    `support: ${startup.support}`,
    `reason: ${startup.reason}`,
    `target: ${TARGET}`,
    `detected: ${statusValue(startup.detected)}`,
    `collection consent: ${consent}`,
    `Run collection mode: ${collectionMode}`,
    `latest collection boundary: ${boundarySummary(runMode?.value)}`,
    `pending reconciliation: ${reconcileSummary()}`,
    `clear transition: ${clearSummary()}`,
    `archive: ${archive}`,
    `project: ${startup.projectPath ? statusValue(startup.projectPath) : 'unavailable'}`,
    `database root: ${startup.databaseRoot ? statusValue(startup.databaseRoot) : 'unavailable'}`,
    `helper: ${helper}`,
    `locator: ${startup.locatorPath ? statusValue(startup.locatorPath) : 'unavailable'}`,
    `run: ${startup.runId ?? 'unavailable'}`,
  ].join('\n')
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
   a second before, and the conversation `/fork` continues elsewhere gets its
   locator only once it is taken up. The first submission that meets such a
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
  kind: BoundaryKind,
  appended: { eventId: string; sequence: number },
  runId: string = startup.runId ?? '',
  segmentId: string | undefined = startup.sessionId,
): void {
  if (timeline.some(item => item.eventId === appended.eventId)) return
  timeline = [
    ...timeline,
    {
      kind: 'boundary',
      eventId: appended.eventId,
      sequence: appended.sequence,
      runId,
      ...(segmentId ? { segmentId } : {}),
      boundary: kind,
    },
  ]
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
  try {
    if (await settlePending($, currentProject) === 'blocked') {
      return '仍有未决的 Pending Capture 待对账，未启用采集；请先完成对账。'
    }
  } catch {
    return 'Prompt Trail 无法读取未决的 Pending Capture，未启用采集。'
  }

  /* A resume boundary written ahead of a Clear Boundary that is still owed
     would order the segment break after the interval it precedes, so the queue
     is emptied first and enable refuses while anything is left in it. */
  if (await drainLifecycle($, currentProject) === 'blocked') {
    return 'Prompt Trail 仍有中断的 Clear Boundary 或 Run 边界待补写，未启用采集。'
  }

  if (archiveUnavailable) {
    return 'Prompt Trail 档案当前不可用，未启用采集。'
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
    recordBoundary('collection-stopped', stop)
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
  } catch {
    await markArchiveUnavailable($, currentProject)
    return 'Prompt Trail 无法写入 Collection Boundary，未启用采集。'
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

  recordBoundary(kind, appended)
  $.ui.invalidate('ui.render')
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
    recordBoundary(kind, appended)
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
    return next(e)
  })

  /* Spec §9: a `clear` end cuts a Conversation Segment and an exit ends the
     Run; an in-process `resume` does neither. Every reason goes to the state
     machine, which tells them apart. The event cannot be prevented and its
     result is not this plugin's to change, so the hook writes what it can and
     hands the event on untouched. */
  on('classic.SessionEnd', async ($, e, next) => {
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
      await ensureTimeline($)
      expanded = true
      await saveExpanded($)
      $.ui.invalidate('ui.render')
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
          /* Best effort: a pending this Run has not met yet still blocks it,
             so status says so rather than reading as healthy. A failure here
             never costs the rest of the report. */
          try {
            await discoverPending($, currentProject)
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
    return { text: '用法：/prompt-history [enable|disable|status]' }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind !== 'composer') return next(e)
    if (!runtimeTarget) return next(e)
    await awaitStartup($)

    let currentProject: ProjectState
    try {
      currentProject = await prepareProject($)
    } catch {
      /* A Run that is already known to be disabled collects nothing, so there
         is nothing to miss and nothing to block. */
      if (runMode?.value.mode === 'disabled') return next(e)
      if (project?.consent === 'enabled') {
        return { drop: 'Prompt Trail 无法证明当前项目身份；为避免漏记，本次提交已阻止。' }
      }
      return next(e)
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
        return { drop: 'Prompt Trail 无法读取当前 Run collection mode；为避免漏记，本次提交已阻止。' }
      }
      return next(e)
    }
    if (mode.mode === 'disabled') return next(e)

    try {
      startup = await inspectTarget(
        $,
        runtimeTarget.isInteractive,
        runtimeTarget.surface,
        runtimeTarget.cwd,
      )
    } catch {
      if (currentProject.consent === 'enabled') {
        return { drop: 'Prompt Trail preflight 失败；为避免漏记，本次提交已阻止。' }
      }
      return next(e)
    }
    if (startup.support !== 'supported') {
      if (currentProject.consent === 'enabled') {
        return { drop: 'Prompt Trail 当前不可采集；为避免漏记，本次提交已阻止。' }
      }
      return next(e)
    }
    if (!startup.databaseRoot) {
      return { drop: 'Prompt Trail 无法证明数据库位置；本次提交未进入会话。' }
    }
    currentProject.databasePath = `${startup.databaseRoot}/${currentProject.id}.sqlite3`
    startup.projectPath = currentProject.root

    let decision: ConsentDecision | undefined
    try {
      decision = await requestConsent($, currentProject)
    } catch {
      return { drop: 'Prompt Trail 无法完成采集同意；本次提交未进入会话。' }
    }
    if (decision === 'declined') return next(e)
    if (decision !== 'enabled') {
      return { drop: '请选择“启用”或“继续但不启用”后再提交。' }
    }

    /* Anything unresolved is settled before another capture is staged, so a
       second pending can never pile onto the first. This runs ahead of the
       archive block, because a pending the archive still holds is exactly what
       an earlier uncertain failure may have left behind — blocking on the flag
       first would make it unreachable forever. */
    let settled: 'clear' | 'settled' | 'blocked'
    try {
      settled = await settlePending($, currentProject)
    } catch {
      await markArchiveUnavailable($, currentProject)
      const restored = await restoreDraft($, e.text)
      return {
        drop: `Prompt Trail 无法读取未决的 Pending Capture，${draftNote(restored)}；为避免漏记，本次提交已阻止。`,
      }
    }
    if (settled !== 'clear') {
      /* A submission that met a reconciliation is never sent on the person's
         behalf, whether or not it succeeded: the draft goes back and they
         press Enter again. */
      const restored = await restoreDraft($, e.text)
      return {
        drop: settled === 'settled'
          ? `Prompt Trail 已完成对账，${draftNote(restored)}；请重新提交。`
          : `Prompt Trail 仍有未决的 Pending Capture 待对账，${draftNote(restored)}；本次提交未进入会话。`,
      }
    }

    /* After the pending is settled and before anything new is staged: the
       Pending Capture belongs to the segment before the `/clear`, so it is
       archived first, and the Clear Boundary then takes the sequence that
       separates it from this submission. */
    if (await drainLifecycle($, currentProject) === 'blocked') {
      const restored = await restoreDraft($, e.text)
      return {
        drop: `Prompt Trail 无法补写中断的 Clear Boundary 或 Run 边界，${draftNote(restored)}；为避免漏记，本次提交已阻止。`,
      }
    }

    if (archiveUnavailable) {
      return { drop: 'Prompt Trail 档案当前不可用；为避免漏记，本次提交已阻止。' }
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
    if ('drop' in aligned) return aligned

    let branch: { key: string; value: BranchState }
    const eventId = crypto.randomUUID()
    const attachmentKinds = e.attachments?.map(attachment => attachment.type) ?? []
    try {
      branch = await branchState($, currentProject)
      await beginCapture(
        $,
        currentProject,
        branch.value,
        eventId,
        await $.clock.now(),
        e.text,
        attachmentKinds,
      )
    } catch {
      /* The helper may have committed the pending row and died before saying
         so, so this Run stops trusting its earlier "nothing owed" answer and
         asks the archive again on the next submission. */
      pendingDiscovered = false
      await markArchiveUnavailable($, currentProject)
      const restored = await restoreDraft($, e.text)
      return {
        drop: `Prompt Trail 无法预写 Pending Capture，${draftNote(restored)}；本次提交未进入会话。`,
      }
    }

    let result
    try {
      result = await next(e)
    } catch (error) {
      /* The capture is staged and the submission's fate is unknown, so the
         pending must be rediscoverable rather than sealed behind the flag. */
      pendingDiscovered = false
      await markArchiveUnavailable($, currentProject)
      throw error
    }
    const finalText = result.text
    if (typeof finalText !== 'string') {
      try {
        await abortCapture($, currentProject, eventId)
      } catch {
        await markArchiveUnavailable($, currentProject)
      }
      return result
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
      } catch {
        await markArchiveUnavailable($, currentProject)
      }
      return result
    }

    try {
      const sequence = await confirmCapture($, currentProject, eventId, finalText)
      const nextBranch: BranchState = {
        ...branch.value,
        parentEventId: eventId,
      }
      await $.store.set(branch.key, nextBranch)
      rememberBranch(branch.key, nextBranch)
      transcriptMark = { key: branch.key, mark: markTranscript(aligned.messages, finalText) }
      timeline = [
        ...timeline,
        {
          kind: 'prompt',
          eventId,
          sequence,
          runId: startup.runId ?? '',
          ...(startup.sessionId ? { segmentId: startup.sessionId } : {}),
          branchId: branch.value.branchId,
          parentEventId: branch.value.parentEventId,
          text: finalText,
          attachmentCount: attachmentKinds.length,
        },
      ]
      $.ui.invalidate('ui.render')
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
        },
        finalText,
      )
    }
    return result
  })

  on('ui.render', { component: 'AbovePrompt', surface: 'terminal' }, ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const toggle = async () => {
      expanded = !expanded
      $.ui.invalidate('ui.render')
      await saveExpanded($)
      if (expanded && (startup.support !== 'supported' || timelineLoaded === undefined)) {
        await refreshStartup($)
        await ensureTimeline($)
        $.ui.invalidate('ui.render')
      }
    }
    if (!expanded) {
      return (
        <Button
          key="prompt-trail:toggle"
          plain
          label="▸ Prompt Trail"
          onPress={toggle}
        />
      )
    }
    /* The displayed number counts Prompt Entries only, so a boundary drawn in
       between never consumes a position in the session-level numbering. */
    let position = 0
    const ordered = [...timeline].sort((left, right) => left.sequence - right.sequence)
    const attachment = lifecycle?.key.endsWith(`:${startup.runId}`)
      ? lifecycle.value.attachment
      : undefined
    const unclosed = unrecordedLeavings(
      ordered,
      attachment !== undefined && !attachment.closed && attachment.host === startup.hostGeneration,
    )
    const origins = splitOrigins(ordered)
    const forks = forkSources(ordered)
    const starts = branchStarts(ordered)
    const currentKey = project && startup.runId && startup.sessionId
      ? branchKey(project.id, startup.runId, startup.sessionId)
      : undefined
    const folds = foldTimeline(
      ordered,
      startup.runId ?? '',
      activeBranch && activeBranch.key === currentKey ? activeBranch.value.parentEventId : null,
    )
    type Row = { key: string; text: string; dim: boolean; fold?: string }
    const rows = ordered.flatMap((item): Row[] => {
      const before: Row[] = []
      if (item.kind === 'prompt') {
        const fold = folds.folded.get(item.eventId)
        /* Numbered whether or not it is drawn, so opening a fold never
           renumbers the entries around it. */
        position += 1
        if (fold === item.eventId) {
          const open = openFolds.has(fold)
          before.push({
            key: `prompt-trail:fold:${fold}`,
            text: `${open ? '▾' : '▸'} 另一分支 · ${folds.counts.get(fold) ?? 0} 条`,
            dim: true,
            fold,
          })
        }
        if (fold !== undefined && !openFolds.has(fold)) {
          /* A Run left unrecorded is never hidden inside a fold. */
          return unclosed.has(item.eventId)
            ? [...before, { key: `prompt-trail:unclosed:${item.eventId}`, text: boundaryLine('run-unclosed'), dim: true }]
            : before
        }
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
      const drawn = {
        key: `prompt-trail:${item.kind}:${item.eventId}`,
        text: item.kind === 'boundary'
          ? boundaryLine(
              item.boundary,
              item.boundary === 'run-started'
                ? forks.get(item.runId) ?? origins.get(item.eventId)
                : origins.get(item.eventId),
            )
          : `${position}. ${entryLine(item)}`,
        dim: item.kind === 'boundary',
      }
      const runId = unclosed.get(item.eventId)
      return runId === undefined
        ? [...before, drawn]
        : [...before, drawn, { key: `prompt-trail:unclosed:${item.eventId}`, text: boundaryLine('run-unclosed'), dim: true }]
    })
    return (
      <Box flexDirection="column">
        <Button
          key="prompt-trail:toggle"
          plain
          label="▾ Prompt Trail"
          onPress={toggle}
        />
        {rows.length === 0 ? (
          <Text dimColor>尚无 Prompt Entry</Text>
        ) : rows.map(row => row.fold !== undefined ? (
          <Button
            key={row.key}
            plain
            label={row.text}
            onPress={() => {
              const fold = row.fold as string
              if (openFolds.has(fold)) openFolds.delete(fold)
              else openFolds.add(fold)
              $.ui.invalidate('ui.render')
            }}
          />
        ) : (
          <Text
            key={row.key}
            wrap="truncate-end"
            {...(row.dim ? { dimColor: true } : {})}
          >
            {row.text}
          </Text>
        ))}
      </Box>
    )
  })
}
