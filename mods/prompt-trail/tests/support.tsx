import type { On, PromptAttachment, PromptOrigin, ToolResultSummary } from 'claude-code'
import { mock } from 'claude-code/testing'
import { EXPECTED_HELPER_SHA256, HELPER_PROTOCOL } from '../hooks/artifact'

export const SECRET = 'PT-SECRET-CONSENT-CAPTURE\nsecond line'
export const FINAL_SECRET = 'PT-SECRET-FINAL-CAPTURE\nsecond line'
export const projectRoot = '/tmp/prompt-trail-project'
export const projectId =
  '2f8f609b94d1dceb67370dea36cf1d5e5a9cd5dc909d3a0673cbc45b69ea1796'
export const sessionId = '11111111-2222-4333-8444-555555555555'
export const runId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
export const archiveGeneration = '99999999-8888-4777-8666-555555555555'
export const home = '/Users/tester'
export const pluginRoot = '/opt/prompt-trail'
export const pluginData = '/Users/tester/.claude/plugins/data/prompt-trail-inline'
export const helperPath = `${pluginRoot}/bin/prompt-trail-helper`
export const manifestPath = `${pluginRoot}/artifacts/helper-manifest.json`
export const databaseRoot = `${pluginData}/archives`
export const databasePath = `${databaseRoot}/${projectId}.sqlite3`
export const locatorDirectory =
  `${home}/.claude/plugins/data/.function-hook-locators/prompt-trail`
/* The bridge names a locator after the session and the host process generation
   that published it. */
export function locatorName(forSessionId: string, hostPid = 4242): string {
  return `${forSessionId}.${hostPid}-100-200.json`
}
export const locatorPath = `${locatorDirectory}/${locatorName(sessionId)}`
/* The classic session id the host reports, held in a box so a test can rotate
   it the way a `/clear` does and watch what the next submission does with the
   new Conversation Segment. */
export type ClassicSession = { id: string }
export const session = {
  cwd: projectRoot,
  surface: 'terminal' as const,
  isInteractive: true,
}

/* One Timeline Event as the archive holds it. A test that shares one array
   between two phases is sharing the archive across them, the way a reload or a
   restart shares the project's SQLite file. */
export type ArchiveRow = {
  kind: string
  eventId: string
  sequence: number
  runId: string
  segmentId: string
  branchId: string
  /* A Prompt Entry's logical parent; boundaries have none. */
  parentEventId?: string | null
  occurredAt?: number
  text?: string
  attachmentCount?: number
}

/* The Run the locator names and the process generation that published it,
   held in a box so a test can move to another Run the way an in-process
   `/resume` does, or to another process the way a restart does. */
/* One row of `$.session.messages()` as a test writes it. */
export type TranscriptRow = {
  role: 'user' | 'assistant'
  text: string
  toolResults?: ToolResultSummary[]
}

export type RunIdentity = { runId: string; hostPid?: number }

export type ProcessCall = {
  argv: string[]
  stdin?: string
}

export type TargetOptions = {
  ask?: '启用' | '继续但不启用'
  consent?: unknown
  rewrite?: boolean
  dropBeneath?: string
  storeSetFails?: boolean
  store?: Record<string, unknown>
  gitExitCode?: number
  hasGitDirectory?: boolean
  preflightThrows?: boolean
  /* A failing helper subcommand: `true` answers `archive-sqlite`, a string
     answers that category. */
  confirmFails?: boolean | string
  /* Fails only the first confirmation, so a later reconciliation can land. */
  confirmFailsOnce?: boolean
  beginFails?: boolean | string
  /* The host kills `capture-begin` at its time limit: the call rejects. */
  beginRejects?: boolean
  abortFails?: boolean | string
  boundaryFails?: boolean | string
  /* `boundary-append` of this kind fails with `archive-busy`. */
  boundaryFailsFor?: { kind: string }
  listFails?: boolean | string
  /* What a successful `capture-begin` says about the archive's disk; absent,
     it says nothing, as a helper that could not ask the disk does. */
  lowSpace?: boolean
  /* The answers the Archive unavailable dialog receives, one per dialog in
     order; once they run out, a dialog is cancelled. */
  unavailableAnswers?: (
    '重试' | '禁用当前 Run 后继续' | '重新检查完整性' | '初始化并完整复检' | '隔离并开始新档案' | '清除全部档案' | '继续清除'
  )[]
  /* The answers the clear-all confirmation receives, one per dialog in order:
     an option's label, or what the person typed; once they run out, a dialog
     is cancelled. */
  clearAnswers?: string[]
  /* The text and options of every clear-all confirmation. */
  clearAsked?: string[]
  clearOffered?: string[][]
  /* A clear begun and not finished: every command that opens the archive
     is refused as `clear-unfinished` until a clear-all finishes it. */
  clearUnderway?: { value: boolean }
  /* `clear-all` cuts but cannot remove these files, and stops unfinished. */
  clearLeaves?: { name: string; bytes: number }[]
  /* Runs of the project a live process elsewhere is attached to. */
  otherLiveRuns?: number | null
  /* The archive can no longer count its Pending Captures. */
  pendingUnknown?: boolean
  /* The host kills `clear-all` after its cut: the call rejects and the
     clear is left under way. */
  clearRejects?: boolean
  /* Session index records `clear-all` could not remove. */
  sessionsFailed?: number
  /* A Run clear begun and not finished, for the Run named: every command
     that opens the archive is refused as `clear-run-unfinished` until a
     Run clear finishes it. */
  clearRunUnderway?: { value: boolean; runId?: string }
  /* `clear-run` deletes but cannot empty these files, and stops unfinished;
     `clear-inventory` lists them while it is. */
  clearRunLeaves?: { name: string; bytes: number }[]
  /* The host kills `clear-run` after its cut. */
  clearRunRejects?: boolean
  /* `clear-run` finishes, and its answer never reaches the plugin. */
  clearRunAnswerLost?: boolean
  /* `capture-begin` refuses a parent the archive does not hold, as the
     helper does; off, any parent is staged. */
  parentsChecked?: boolean
  /* The options each Archive unavailable dialog offered, in order. */
  unavailableOffered?: string[][]
  /* The Archive generation standing at the archive's path; a quarantine puts
     the next one in its place. */
  generation?: { value: string }
  /* The helper's shared health receipt, independent of the display store. */
  health?: { state: 'unknown' | 'healthy' | 'damaged'; generation: string | null; token: string | null }
  healthFails?: string
  /* Schedules another helper operation at the process boundary, or returns a
     deliberately malformed/stale response; no plugin decision is mocked. */
  processResponder?: (call: ProcessCall) => { exitCode: number; stdout: string; stderr: string } | undefined
  /* What `integrity-check` finds. */
  integrity?: { result: 'ok' | 'damaged' | 'unreadable' | 'absent'; problems: number }
  /* `quarantine` fails with this category, moving nothing. */
  quarantineFails?: string
  /* A quarantine begun and not finished: `archive-status` says so, and the
     next `quarantine` finishes it whatever generation it names. */
  quarantineUnderway?: { value: boolean }
  /* The quarantined archives `archive-status` lists; a quarantine adds one. */
  quarantined?: { name: string; path: string; bytes: number }[]
  /* The text of every Archive unavailable dialog, as the person reads it. */
  unavailableAsked?: string[]
  /* What `capture-list` answers: the pendings the archive still holds. A
     resolved one is dropped from the front, the way the archive would. */
  pendingList?: Record<string, unknown>[]
  /* Runs a live process other than this one is attached to: `capture-list`
     leaves their pendings out, unless the caller names that Run as its own,
     and `archive-status` lists them. */
  liveRuns?: string[]
  /* `archive-status` fails with this category. */
  statusFails?: string
  /* The bytes `archive-status` gives for the archive in place. */
  archiveBytes?: number
  /* `clear-all` could not read the archive's counts: it was damaged, or an
     earlier clear had already removed it. */
  clearCountsUnknown?: boolean
  /* Another Run settled every listed pending first: a confirmation finds it
     gone and an abort finds it confirmed, as the helper answers each. */
  settledElsewhere?: boolean
  /* What `$.session.messages()` answers: to reconciliation, and to the
     Active Branch alignment ahead of a session's first capture. */
  messages?: readonly TranscriptRow[]
  /* A live transcript in place of `messages`: every submission the engine
     accepts lands on it as a `user` row, and a test may cut it short the way
     a rewind does. */
  transcript?: TranscriptRow[]
  messagesFail?: boolean
  /* What `branch-match` answers; a function sees the call. The default is the
     answer for a transcript nothing archived matches. */
  branchMatch?: Record<string, unknown> | ((call: ProcessCall) => Record<string, unknown>)
  branchMatchFails?: boolean | string
  /* What the parent-confirmation Pane went through; see `pickParent`. */
  parentPane?: ParentPane
  /* Collects every `$.prompt.fill`, so a test can see the restored draft. */
  fills?: string[]
  /* The host refuses to write the draft back, as a dialog holding the keys
     or a headless session would. */
  fillFails?: boolean
  /* The answer a reconciliation dialog receives; `undefined` cancels it. */
  reconcileAnswer?: '已进入' | '未进入' | '新根分支' 
  /* Any store key containing this substring throws on read. */
  storeGetFailsFor?: string
  /* Any store key containing this substring throws on write. */
  storeSetFailsFor?: string
  /* Conversation Branch writes throw once this many have succeeded. */
  branchSetFailsAfter?: number
  /* Runs while a composer submission is inside the downstream hook. */
  duringSubmit?: () => Promise<void>
  /* The classic session the host reports; rotating `id` moves the target onto
     the locator a `/clear` would have published. */
  classicSession?: ClassicSession
  /* The persisted archive; confirmed prompts and boundaries are appended to it
     and `timeline-read` answers from it. */
  archive?: ArchiveRow[]
  readFails?: boolean | string
  /* An AskUserQuestion dialog stays up until this settles; one that rejects
     is a dialog that failed. */
  askHold?: Promise<void>
  /* Runs while an AskUserQuestion dialog is up, before it is answered. */
  duringAsk?: () => void
  /* Runs right after a store write lands, as another process writing the
     same key a moment later would. */
  afterStoreSet?: (key: string) => void
  beforeStoreDelete?: (key: string) => void
  run?: RunIdentity
  /* The session the locator says this one continues: the conversation was
     moved here from it, and this session took up its Run. */
  continuedFrom?: string
  /* Whether the bridge has published this session's locator yet; a session
     the host started a moment ago may run its hooks before it has. */
  locatorPublished?: { value: boolean }
  /* Hands the test the mocked clock, to move it past a wait. */
  onClock?: (clock: import('claude-code/testing').MockClock) => void
  /* Every move of a focus ring that reached the engine. */
  focuses?: { element?: string; origin: { kind: string } }[]
  /* The digest `shasum` reports for the helper file right now. */
  helperDigest?: { value: string }
}

/* The helper's fixed read batch. */
export const TIMELINE_READ_LIMIT = 128

/* Prompt Entries and every kind of boundary share one project-level sequence,
   and the helper allocates it once per event id: a repeat answers the stored
   sequence rather than a second one, and a rolled-back write allocates none.
   A row a test adds to the archive itself (another Run writing meanwhile)
   takes its sequence first. */
function sequenceAllocator(archive: readonly ArchiveRow[]): (eventId: string) => number {
  const allocated = new Map<string, number>(archive.map(row => [row.eventId, row.sequence]))
  let next = 0
  return eventId => {
    const existing = allocated.get(eventId) ?? archive.find(row => row.eventId === eventId)?.sequence
    if (existing !== undefined) return existing
    next = Math.max(next, ...archive.map(row => row.sequence)) + 1
    allocated.set(eventId, next)
    return next
  }
}

/* One `timeline-read` batch as the helper answers it: 128 events and one more
   on the side read towards, each Prompt Entry's ordinal, and the context the
   view derives from events outside the batch. `rest` is the argv after the
   protocol: an optional `before|after <sequence>`, then `<run|-> <tip|->`. */
export function timelineBatch(archive: readonly ArchiveRow[], rest: readonly string[]) {
  const [direction, cursor] = rest.length === 4 ? [rest[0], Number(rest[1])] : [undefined, 0]
  const [run, tip] = rest.slice(-2)
  const ordered = [...archive].sort((left, right) => left.sequence - right.sequence)
  const rows = TIMELINE_READ_LIMIT + 1
  const events = direction === 'after'
    ? ordered.filter(row => row.sequence > cursor).slice(0, rows)
    : (direction === 'before' ? ordered.filter(row => row.sequence < cursor) : ordered).slice(-rows)
  const low = events[0]?.sequence ?? (direction === 'after' ? cursor + 1 : direction === 'before' ? cursor : 1)
  const high = events.at(-1)?.sequence ?? (direction === 'after' ? cursor : direction === 'before' ? cursor - 1 : 0)
  const prompts = ordered.filter(row => row.kind === 'prompt')
  const byId = new Map(ordered.map(row => [row.eventId, row]))
  const inBatch = new Set(events.map(row => row.eventId))
  const parents = new Map<string, string>()
  for (const row of events) {
    const parent = row.kind === 'prompt' && row.parentEventId ? byId.get(row.parentEventId) : undefined
    if (parent && !inBatch.has(parent.eventId)) parents.set(parent.eventId, parent.runId)
  }
  const origins = events.flatMap(row => {
    if (row.kind !== 'run-started') return []
    const holder = ordered.find(other => other.segmentId === row.segmentId)
    return holder && holder.runId !== row.runId ? [{ eventId: row.eventId, runId: holder.runId }] : []
  })
  let path: { eventIds: string[]; start: number | null } | undefined
  if (tip !== undefined && tip !== '-') {
    path = { eventIds: [], start: null }
    for (let at = byId.get(tip); at; at = byId.get(at.parentEventId ?? '')) {
      if (at.sequence >= low && at.sequence <= high) path.eventIds.push(at.eventId)
      if (at.runId === run) path.start = at.sequence
    }
  }
  return {
    projectId,
    events: events.map(row => ({
      eventId: row.eventId,
      sequence: row.sequence,
      runId: row.runId,
      segmentId: row.segmentId,
      branchId: row.branchId,
      kind: row.kind,
      ...(row.kind === 'prompt'
        ? {
            parentEventId: row.parentEventId ?? null,
            text: row.text ?? '',
            attachmentCount: row.attachmentCount ?? 0,
            ordinal: prompts.indexOf(row) + 1,
          }
        : {}),
    })),
    earlier: ordered.some(row => row.sequence < low),
    later: ordered.some(row => row.sequence > high),
    ...(path ? { path } : {}),
    parents: [...parents].map(([eventId, runId]) => ({ eventId, runId })),
    origins,
  }
}

export function installSupportedTarget(
  on: On,
  options: TargetOptions = {},
): ProcessCall[] {
  const calls: ProcessCall[] = []
  const classic = options.classicSession ?? { id: sessionId }
  const identity = options.run ?? { runId }
  const currentLocatorPath = () =>
    `${locatorDirectory}/${locatorName(classic.id, identity.hostPid)}`
  const archive = options.archive ?? []
  /* A clear leaves no file at the archive's path until the next write, and
     `archive-status` then names no generation. */
  let emptied = false
  let allocateSequence = sequenceAllocator(archive)
  const generation = options.generation ?? { value: 'gen-1' }
  const health: NonNullable<TargetOptions['health']> = options.health ?? {
    state: 'healthy', generation: generation.value, token: '11111111-1111-4111-8111-111111111111',
  }
  const startEmptyArchive = () => {
    if (health.state === 'unknown' && health.generation === null) {
      Object.assign(health, { state: 'healthy', generation: generation.value, token: crypto.randomUUID() })
      emptied = false
    }
  }
  const refuse = (category: boolean | string, foundGeneration?: string) => {
    if (category === 'archive-integrity'
        && (health.state !== 'damaged' || health.generation !== (foundGeneration ?? generation.value))) {
      Object.assign(health, {
        state: 'damaged', generation: foundGeneration ?? generation.value,
        token: '33333333-3333-4333-8333-333333333333',
      })
    }
    return failure(category, foundGeneration)
  }
  const quarantined = options.quarantined ?? []
  const staged = new Map<string, Omit<ArchiveRow, 'sequence'>>()
  let branchWrites = 0
  mock.env(on, { HOME: home })
  const clock = mock.clock(on, { now: 1_795_000_000_000 })
  options.onClock?.(clock)
  if (options.storeSetFails) {
    on('store.get', () => ({ value: undefined }))
    on('store.keys', () => ({ value: [] }))
    on('store.set', () => {
      throw new Error('store unavailable: PT-SECRET-STORE')
    })
  } else if (options.store) {
    const store = options.store
    on('store.get', (_$, e) => {
      if (options.storeGetFailsFor && e.key.includes(options.storeGetFailsFor)) {
        throw new Error('store unavailable: PT-SECRET-STORE-GET')
      }
      return { value: store[e.key] }
    })
    on('store.set', (_$, e) => {
      if (options.storeSetFailsFor && e.key.includes(options.storeSetFailsFor)) {
        throw new Error('store unavailable: PT-SECRET-STORE-SET')
      }
      if (e.key.startsWith('prompt-trail:branch:')
          && options.branchSetFailsAfter !== undefined) {
        if (branchWrites >= options.branchSetFailsAfter) {
          throw new Error('store unavailable: PT-SECRET-STORE-SET')
        }
        branchWrites += 1
      }
      store[e.key] = e.value
      options.afterStoreSet?.(e.key)
      return { value: undefined }
    })
    on('store.delete', (_$, e) => {
      options.beforeStoreDelete?.(e.key)
      delete store[e.key]
      return { value: undefined }
    })
    /* The engine's own store answers `keys`; a double that did not would make
       every enumeration of another Run's lifecycle debt throw. */
    on('store.keys', () => {
      if (options.storeGetFailsFor === '*') {
        throw new Error('store unavailable: PT-SECRET-STORE-KEYS')
      }
      return { value: Object.keys(store) }
    })
  } else {
    mock.store(on, options.consent === undefined
      ? undefined
      : { [`prompt-trail:consent:${projectId}`]: options.consent })
  }
  on('fs.exists', () => ({ value: options.hasGitDirectory ?? false }))
  on('fs.list', (_$, e) => ({
    value: e.path === locatorDirectory && (options.locatorPublished?.value ?? true)
      ? [{ name: locatorName(classic.id, identity.hostPid), kind: 'file' as const, size: 1 }]
      : [],
  }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: classic.id }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('fs.read', () => ({
    value: JSON.stringify({
      locatorVersion: 1,
      pluginProtocol: 1,
      helperProtocol: HELPER_PROTOCOL,
      sessionId: classic.id,
      hostPid: identity.hostPid ?? 4242,
      hostStartSeconds: 100,
      hostStartMicroseconds: 200,
      hostExecutable: '/opt/claude/2.1.278',
      hostVersion: '2.1.278',
      pluginRoot,
      pluginData,
      databaseRoot,
      helperPath,
      manifestPath,
      helperSha256: EXPECTED_HELPER_SHA256,
      artifactStatus: 'trusted',
      runId: identity.runId,
      archiveGeneration,
      ...(options.continuedFrom === undefined ? {} : { continuedFrom: options.continuedFrom }),
    }),
  }))
  on('tool.call', { tool: 'AskUserQuestion' }, async (_$, e) => {
    if (options.askHold) await options.askHold
    options.duringAsk?.()
    const question = e.questions[0]?.question ?? ''
    const choices = e.questions[0]?.options ?? []
    const labels = choices.map(choice => (typeof choice === 'string' ? choice : choice.label))
    const isReconcile = labels.includes('已进入')
    if (labels.includes('取消') && !labels.includes('禁用当前 Run 后继续')
        && !labels.includes('初始化并完整复检')) {
      options.clearAsked?.push(question)
      options.clearOffered?.push(labels)
      const answer = options.clearAnswers?.shift()
      return {
        result: { questions: e.questions, answers: answer ? { [question]: answer } : {} },
      }
    }
    if (labels.includes('禁用当前 Run 后继续') || labels.includes('初始化并完整复检')) {
      options.unavailableAsked?.push(question)
      options.unavailableOffered?.push(labels)
      const answer = options.unavailableAnswers?.shift()
      return {
        result: { questions: e.questions, answers: answer ? { [question]: answer } : {} },
      }
    }
    if (isReconcile) {
      /* A cancelled dialog answers nothing, which is what keeps the Run
         blocked rather than defaulting to confirm or discard. */
      if (!options.reconcileAnswer) return { result: { questions: e.questions, answers: {} } }
      return {
        result: {
          questions: e.questions,
          answers: { [question]: options.reconcileAnswer },
        },
      }
    }
    return {
      result: {
        questions: e.questions,
        answers: { [question]: options.ask ?? '启用' },
      },
    }
  })
  const pane = options.parentPane
  if (pane) pane.clock = clock
  /* The engine moving the band's focus ring: it moves. A plugin's own
     `$.ui.scroll` never reaches a hook here (the test engine lays nothing
     out), so where the window lands is left to the terminal acceptance. */
  on('ui.focus', (_$, e) => {
    options.focuses?.push({ ...(e.element === undefined ? {} : { element: e.element }), origin: e.origin })
    return {}
  })
  on('ui.scroll', () => ({}))
  on('ui.open', (_$, e) => {
    if (pane && e.id === PARENT_PANE_ID) {
      if (pane.refused) return { deny: 'pane refused: PT-SECRET-REFUSED' }
      pane.opens.push({ ...e })
      pane.log.push('open')
    }
    return { value: undefined }
  })
  on('ui.close', (_$, e) => {
    if (pane && e.id === PARENT_PANE_ID) pane.log.push(`close:${e.origin.kind}`)
    return { value: undefined }
  })
  on('ui.toast', (_$, e) => {
    pane?.toasts.push(e.text)
    return { value: undefined }
  })
  if (options.fills || options.fillFails || pane) {
    const fills = options.fills
    on('prompt.fill', (_$, e) => {
      fills?.push(e.text)
      pane?.log.push('fill')
      return { isFilled: !options.fillFails }
    })
  }
  on('session.messages', () => {
    if (options.messagesFail) throw new Error('transcript unavailable: PT-SECRET-MESSAGES')
    return {
      value: (options.transcript ?? options.messages ?? []).map(message => ({ ...message, toolUses: [] })),
    }
  })
  on('process.run', (_$, e) => {
    const argv = [...e.argv]
    calls.push({ argv, stdin: e.init?.stdin })
    const response = options.processResponder?.(calls[calls.length - 1]!)
    if (response) return { value: response }
    if (argv[0] === '/usr/bin/uname' && argv[1] === '-s') {
      return { value: { exitCode: 0, stdout: 'Darwin\n', stderr: '' } }
    }
    if (argv[0] === '/usr/bin/uname' && argv[1] === '-m') {
      return { value: { exitCode: 0, stdout: 'arm64\n', stderr: '' } }
    }
    if (argv[0] === '/usr/bin/sw_vers') {
      return { value: { exitCode: 0, stdout: '15.8\n', stderr: '' } }
    }
    if (argv[0] === '/usr/bin/id') {
      return { value: { exitCode: 0, stdout: '501\n', stderr: '' } }
    }
    if (argv[0] === '/bin/ls') {
      return { value: { exitCode: 0, stdout: 'private path\n', stderr: '' } }
    }
    if (argv[0] === '/bin/realpath') {
      return { value: { exitCode: 0, stdout: `${argv[1]}\n`, stderr: '' } }
    }
    if (argv[0] === '/usr/bin/stat') {
      const path = argv[argv.length - 1]
      const directory = path === locatorDirectory
        || path === pluginData
        || path === pluginRoot
        || path === `${pluginRoot}/bin`
        || path === `${pluginRoot}/artifacts`
      return {
        value: {
          exitCode: 0,
          stdout: `${directory ? 'Directory' : 'Regular File'}|501|${directory ? '700' : path === currentLocatorPath() ? '600' : '755'}\n`,
          stderr: '',
        },
      }
    }
    if (argv[0] === '/usr/bin/shasum') {
      return {
        value: {
          exitCode: 0,
          stdout: `${options.helperDigest?.value ?? EXPECTED_HELPER_SHA256}  ${helperPath}\n`,
          stderr: '',
        },
      }
    }
    if (argv[0] === '/usr/bin/git' || (argv[0] === '/usr/bin/env' && argv.includes('/usr/bin/git'))) {
      const exitCode = options.gitExitCode ?? 0
      return {
        value: {
          exitCode,
          stdout: exitCode === 0 ? `${projectRoot}\n` : '',
          stderr: exitCode === 0 ? '' : 'fatal: PT-SECRET-GIT',
        },
      }
    }
    if (argv[0] === helperPath && argv[1] === 'preflight') {
      if (options.preflightThrows) {
        throw new Error('execution denied: PT-SECRET-PREFLIGHT')
      }
      return {
        value: {
          exitCode: 0,
          stdout: JSON.stringify({
            status: 'supported',
            artifactStatus: 'trusted',
            sessionId: classic.id,
            runId: identity.runId,
            archiveGeneration,
            databaseRoot,
            helperPath,
            helperProtocol: HELPER_PROTOCOL,
            macosVersion: '15.8',
            sqliteVersionNumber: 3_049_001,
            sqliteReturning: true,
          }),
          stderr: '',
        },
      }
    }
    if (argv[0] === helperPath && argv[1] === 'archive-health') {
      if (options.healthFails) return refuse(options.healthFails)
      if (!options.health && health.generation !== generation.value && !emptied) {
        Object.assign(health, {
          generation: generation.value, token: crypto.randomUUID(),
        })
      }
      return {
        value: { exitCode: 0, stdout: JSON.stringify({ projectId, ...health }), stderr: '' },
      }
    }
    if (argv[0] === helperPath && ['archive-health-init', 'archive-health-reset'].includes(argv[1] ?? '')) {
      if (argv[4] !== generation.value) return refuse('archive-generation')
      const reset = argv[1] === 'archive-health-reset'
      if (reset && argv[5] !== health.token) return refuse('archive-health-stale')
      if (reset || health.state === 'unknown') {
        const clean = (options.integrity?.result ?? 'ok') === 'ok'
        const state = clean ? 'healthy' : 'damaged'
        if (clean || health.state !== 'damaged') {
          Object.assign(health, { state, generation: generation.value, token: crypto.randomUUID() })
        }
      }
      return { value: { exitCode: 0, stdout: JSON.stringify({ projectId, ...health }), stderr: '' } }
    }
    /* So does an unfinished Run clear. */
    if (argv[0] === helperPath && options.clearRunUnderway?.value
        && !['preflight', 'archive-status', 'clear-inventory', 'clear-all', 'clear-run'].includes(argv[1] ?? '')) {
      return refuse('clear-run-unfinished')
    }
    /* An unfinished clear refuses every command that opens the archive. */
    if (argv[0] === helperPath && options.clearUnderway?.value
        && !['preflight', 'archive-status', 'clear-inventory', 'clear-all'].includes(argv[1] ?? '')) {
      return refuse('clear-unfinished')
    }
    if (argv[0] === helperPath && argv[1] === 'clear-inventory') {
      const underway = options.clearUnderway?.value === true
      const held = archive.length > 0 || staged.size > 0
      const runUnderway = options.clearRunUnderway?.value === true
      const files = underway
        ? options.clearLeaves ?? []
        : [
            ...(held ? [{ name: `${projectId}.sqlite3`, bytes: 8192 }] : []),
            ...(runUnderway ? options.clearRunLeaves ?? [] : []),
          ]
      const forRun = argv[6]
      const own = archive.filter(row => row.runId === forRun)
      const ownIds = new Set(own.map(row => row.eventId))
      const ownStaged = [...staged.values()].filter(row => row.runId === forRun)
      return {
        value: {
          exitCode: 0,
          stdout: JSON.stringify({
            projectId,
            present: underway || held || quarantined.length > 0,
            clearUnderway: underway,
            clearRunUnderway: runUnderway,
            ...(forRun === undefined
              ? {}
              : {
                  run: underway || runUnderway
                    ? null
                    : {
                        entries: own.filter(row => row.kind === 'prompt').length,
                        pending: ownStaged.length,
                        events: own.filter(row => row.kind !== 'prompt').length,
                        attaches: own.filter(row => row.kind === 'run-started' || row.kind === 'run-attached').length,
                        startedAt: own.length > 0 ? Math.min(...own.map(row => row.occurredAt ?? 1_795_000_000_000)) : null,
                        unlinked: [...archive, ...staged.values()].filter(row =>
                          row.runId !== forRun && ownIds.has(row.parentEventId ?? '')).length,
                      },
                }),
            generation: held ? generation.value : null,
            entries: options.clearCountsUnknown ? null : archive.filter(row => row.kind === 'prompt').length,
            pending: options.pendingUnknown || options.clearCountsUnknown ? null : staged.size,
            otherLiveRuns: options.otherLiveRuns === undefined ? 0 : options.otherLiveRuns,
            files,
            quarantined,
          }),
          stderr: '',
        },
      }
    }
    if (argv[0] === helperPath && argv[1] === 'clear-run') {
      const underway = options.clearRunUnderway?.value === true
      const nothing = {
        value: {
          exitCode: 0,
          stdout: JSON.stringify({
            projectId, cleared: false, continued: false, ownRun: false,
            entries: 0, pending: 0, events: 0, unlinked: 0,
          }),
          stderr: '',
        },
      }
      if (!underway && argv[7] === '--continue') return nothing
      if (!underway && health.state === 'damaged') return refuse('archive-integrity', health.generation ?? generation.value)
      if (!underway && health.state === 'unknown' && health.generation !== null) return refuse('archive-health-unknown')
      if (!underway && quarantined.length > 0) return refuse('clear-run-quarantined')
      const cleared = underway ? options.clearRunUnderway?.runId ?? argv[4] : argv[4]
      const own = archive.filter(row => row.runId === cleared)
      const ownIds = new Set(own.map(row => row.eventId))
      const ownStaged = [...staged].filter(([, row]) => row.runId === cleared)
      if (!underway && own.length + ownStaged.length === 0) return nothing
      if (options.clearRunRejects) {
        if (options.clearRunUnderway) Object.assign(options.clearRunUnderway, { value: true, runId: cleared })
        throw new Error('killed at the time limit: PT-SECRET-KILLED')
      }
      let unlinked = 0
      for (const row of [...archive, ...staged.values()]) {
        if (row.runId !== cleared && ownIds.has(row.parentEventId ?? '')) {
          row.parentEventId = null
          unlinked += 1
        }
      }
      const kept = archive.filter(row => row.runId !== cleared)
      archive.splice(0, archive.length, ...kept)
      for (const [eventId] of ownStaged) staged.delete(eventId)
      if (options.clearRunLeaves?.length) {
        if (options.clearRunUnderway) Object.assign(options.clearRunUnderway, { value: true, runId: cleared })
        return refuse('clear-run-unfinished')
      }
      if (options.clearRunUnderway) options.clearRunUnderway.value = false
      if (options.clearRunAnswerLost) throw new Error('killed at the time limit: PT-SECRET-KILLED')
      return {
        value: {
          exitCode: 0,
          stdout: JSON.stringify({
            projectId, cleared: true, continued: underway, ownRun: cleared === argv[4],
            entries: own.filter(row => row.kind === 'prompt').length,
            pending: ownStaged.length,
            events: own.filter(row => row.kind !== 'prompt').length,
            unlinked,
          }),
          stderr: '',
        },
      }
    }
    if (argv[0] === helperPath && argv[1] === 'clear-all') {
      /* Only finishing a clear under way: one that has finished starts
         nothing new. */
      if (argv[8] === '--continue' && !options.clearUnderway?.value) {
        return {
          value: {
            exitCode: 0,
            stdout: JSON.stringify({
              projectId, cleared: false, entries: 0, pending: 0, quarantined: 0,
              sessionsRemoved: 0, sessionsFailed: 0,
            }),
            stderr: '',
          },
        }
      }
      if (options.clearRejects) {
        if (options.clearUnderway) options.clearUnderway.value = true
        throw new Error('killed at the time limit: PT-SECRET-KILLED')
      }
      const entries = archive.filter(row => row.kind === 'prompt').length
      const pending = staged.size
      const moved = quarantined.length
      archive.splice(0)
      allocateSequence = sequenceAllocator(archive)
      staged.clear()
      quarantined.splice(0)
      /* The path stands empty; the next write begins another generation,
         and damage the old one had went with it. */
      generation.value = `${generation.value}-cleared`
      emptied = true
      if (options.beginFails === 'archive-integrity') options.beginFails = undefined
      if (options.clearLeaves?.length) {
        if (options.clearUnderway) options.clearUnderway.value = true
        return refuse('clear-unfinished')
      }
      if (options.clearUnderway) options.clearUnderway.value = false
      Object.assign(health, { state: 'unknown', generation: null, token: null })
      return {
        value: {
          exitCode: 0,
          stdout: JSON.stringify({
            projectId, cleared: true,
            entries: options.clearCountsUnknown ? null : entries,
            pending: options.pendingUnknown || options.clearCountsUnknown ? null : pending,
            quarantined: moved, sessionsRemoved: 0, sessionsFailed: options.sessionsFailed ?? 0,
          }),
          stderr: '',
        },
      }
    }
    /* An unfinished quarantine refuses every command that opens the archive. */
    if (argv[0] === helperPath && options.quarantineUnderway?.value
        && !['preflight', 'archive-status', 'quarantine'].includes(argv[1] ?? '')) {
      return refuse('quarantine-failed')
    }
    /* The helper rechecks health under its mutation guard. A pre-read is
       advisory: damage may have been published between it and this call. */
    if (argv[0] === helperPath
        && ['capture-begin', 'capture-confirm', 'capture-abort', 'boundary-append'].includes(argv[1] ?? '')) {
      if (health.state === 'damaged') return refuse('archive-integrity', health.generation ?? generation.value)
      if (health.state === 'unknown' && health.generation !== null) return refuse('archive-health-unknown')
    }
    if (argv[0] === helperPath && argv[1] === 'capture-begin') {
      const eventId = argv[8]
      if (options.beginFails) {
        return refuse(options.beginFails, generation.value)
      }
      if (argv[12] !== '-' && argv[12] !== generation.value) return refuse('archive-generation')
      if (options.parentsChecked && argv[7] !== '-'
          && !archive.some(row => row.kind === 'prompt' && row.eventId === argv[7])) {
        return refuse('capture-parent-unknown')
      }
      if (options.beginRejects) throw new Error('timed out: PT-SECRET-KILLED')
      startEmptyArchive()
      if (eventId && !archive.some(row => row.eventId === eventId)) {
        staged.set(eventId, {
          kind: 'prompt',
          eventId,
          runId: argv[4] ?? '',
          segmentId: argv[5] ?? '',
          branchId: argv[6] ?? '',
          parentEventId: argv[7] === '-' ? null : argv[7] ?? null,
          text: e.init?.stdin ?? '',
          attachmentCount: Number(argv[10]),
        })
      }
      return {
        value: {
          exitCode: 0,
          stdout: JSON.stringify({
            eventId,
            projectId,
            generation: generation.value,
            pending: true,
            ...(options.lowSpace === undefined ? {} : { lowSpace: options.lowSpace }),
          }),
          stderr: '',
        },
      }
    }
    if (argv[0] === helperPath && argv[1] === 'capture-confirm') {
      const eventId = argv[4]
      const isFirstConfirm =
        calls.filter(call => call.argv[1] === 'capture-confirm').length === 1
      if (options.settledElsewhere && options.pendingList?.some(row => row.eventId === eventId)) {
        options.pendingList = options.pendingList.filter(row => row.eventId !== eventId)
        return { value: { exitCode: 25, stdout: '', stderr: '{"category":"capture-not-found"}' } }
      }
      if (options.confirmFails || (options.confirmFailsOnce && isFirstConfirm)) {
        return refuse(options.confirmFails || true, generation.value)
      }
      /* A confirmed capture is no longer pending, exactly as the helper's own
         transaction leaves it. */
      if (options.pendingList) {
        options.pendingList = options.pendingList.filter(
          row => row.eventId !== eventId,
        )
      }
      const pending = staged.get(eventId ?? '')
      if (pending) {
        staged.delete(eventId ?? '')
        archive.push({
          ...pending,
          ...(argv[7] === '--stdin' ? { text: e.init?.stdin ?? '' } : {}),
          sequence: allocateSequence(eventId ?? ''),
        })
      }
      return {
        value: {
          exitCode: 0,
          stdout: JSON.stringify({
            eventId,
            projectId,
            sequence: allocateSequence(eventId ?? ''),
            ordinal: archive.filter(row =>
              row.kind === 'prompt' && row.sequence < allocateSequence(eventId ?? '')).length + 1,
          }),
          stderr: '',
        },
      }
    }
    if (argv[0] === helperPath && argv[1] === 'boundary-append') {
      if (options.boundaryFails) {
        return refuse(options.boundaryFails, generation.value)
      }
      if (options.boundaryFailsFor?.kind === argv[7]) return refuse('archive-busy')
      if (argv[10] !== '-' && argv[10] !== generation.value) return refuse('archive-generation')
      /* As strict as the helper: a repeated id answers the stored sequence
         only when every recorded fact matches, and a changed one is refused. */
      const [runField, segmentId, branchId, kind, eventId, occurredAt] = argv.slice(4, 10)
      const existing = archive.find(row => row.eventId === eventId)
      if (existing && (
        existing.kind !== kind ||
        existing.runId !== runField ||
        existing.segmentId !== segmentId ||
        existing.branchId !== branchId ||
        existing.occurredAt !== Number(occurredAt)
      )) {
        return {
          value: {
            exitCode: 25,
            stdout: '',
            stderr: '{"category":"boundary-conflict"}',
          },
        }
      }
      startEmptyArchive()
      const sequence = allocateSequence(eventId ?? '')
      if (!existing) {
        archive.push({
          kind: kind ?? '',
          eventId: eventId ?? '',
          sequence,
          runId: runField ?? '',
          segmentId: segmentId ?? '',
          branchId: branchId ?? '',
          occurredAt: Number(occurredAt),
        })
      }
      return {
        value: {
          exitCode: 0,
          stdout: JSON.stringify({ eventId, projectId, kind, sequence }),
          stderr: '',
        },
      }
    }
    if (argv[0] === helperPath && argv[1] === 'timeline-read') {
      if (options.readFails) {
        return refuse(options.readFails, generation.value)
      }
      return {
        value: {
          exitCode: 0,
          stdout: JSON.stringify({ ...timelineBatch(archive, argv.slice(6)), generation: generation.value }),
          stderr: '',
        },
      }
    }
    if (argv[0] === helperPath && argv[1] === 'branch-match') {
      if (options.branchMatchFails) {
        return refuse(options.branchMatchFails, generation.value)
      }
      const call = calls[calls.length - 1]!
      const answer = typeof options.branchMatch === 'function'
        ? options.branchMatch(call)
        : options.branchMatch ?? { match: 'none', candidates: [], candidateCount: 0 }
      /* As the helper numbers them: each candidate's place among the archived
         Prompt Entries, unless the test gave one. */
      const ordinal = (sequence: number) =>
        archive.filter(row => row.kind === 'prompt' && row.sequence < sequence).length + 1
      const candidates = (answer.candidates as Record<string, unknown>[] | undefined ?? [])
        .map(candidate => ({ ordinal: ordinal(candidate.sequence as number), ...candidate }))
      return {
        value: {
          exitCode: 0,
          stdout: JSON.stringify({ projectId, generation: generation.value, ...answer, candidates }),
          stderr: '',
        },
      }
    }
    if (argv[0] === helperPath && argv[1] === 'capture-list') {
      if (options.listFails) {
        return refuse(options.listFails, generation.value)
      }
      if (argv.length !== 7) throw new Error(`unexpected capture-list: ${argv.join(' ')}`)
      const caller = argv[4]
      const held = (row: Record<string, unknown>) =>
        row.runId !== caller && (options.liveRuns ?? []).includes(row.runId as string)
      const pending = options.pendingList ?? []
      return {
        value: {
          exitCode: 0,
          stdout: JSON.stringify({
            projectId,
            generation: generation.value,
            pending: pending.filter(row => !held(row)),
            skipped: pending.filter(held).length,
            truncated: false,
          }),
          stderr: '',
        },
      }
    }
    if (argv[0] === helperPath && argv[1] === 'capture-abort') {
      if (options.settledElsewhere && options.pendingList?.some(row => row.eventId === argv[4])) {
        options.pendingList = options.pendingList.filter(row => row.eventId !== argv[4])
        return { value: { exitCode: 25, stdout: '', stderr: '{"category":"capture-conflict"}' } }
      }
      if (options.abortFails) {
        return refuse(options.abortFails, generation.value)
      }
      /* Only a successful abort removes the row; a failed one leaves the
         pending in the archive, still blocking. */
      if (options.pendingList) {
        options.pendingList = options.pendingList.filter(
          row => row.eventId !== argv[4],
        )
      }
      return { value: { exitCode: 0, stdout: '{"aborted":true}', stderr: '' } }
    }
    if (argv[0] === helperPath && argv[1] === 'integrity-check') {
      const found = options.integrity ?? { result: 'ok', problems: 0 }
      return {
        value: {
          exitCode: 0,
          stdout: JSON.stringify({ projectId, ...found, generation: generation.value }),
          stderr: '',
        },
      }
    }
    if (argv[0] === helperPath && argv[1] === 'quarantine') {
      if (options.quarantineFails) return refuse(options.quarantineFails)
      const resumed = options.quarantineUnderway?.value === true
      if (options.quarantineUnderway) options.quarantineUnderway.value = false
      if (!resumed && argv[4] !== generation.value) {
        return {
          value: {
            exitCode: 0,
            stdout: JSON.stringify({ projectId, generation: generation.value, moved: null }),
            stderr: '',
          },
        }
      }
      /* The archive moves aside whole and the next generation begins with
         the quarantine alone. */
      const moved = `20260928T000000Z-${quarantined.length + 1}`
      quarantined.push({ name: moved, path: `${databaseRoot}/quarantine/${projectId}/${moved}`, bytes: 4096 })
      archive.splice(0)
      allocateSequence = sequenceAllocator(archive)
      const [runField, segmentId, branchId, eventId, occurredAt] = argv.slice(5, 10)
      archive.push({
        kind: 'archive-quarantined',
        eventId: eventId ?? '',
        sequence: allocateSequence(eventId ?? ''),
        runId: runField ?? '',
        segmentId: segmentId ?? '',
        branchId: branchId ?? '',
        occurredAt: Number(occurredAt),
      })
      generation.value = `gen-${quarantined.length + 1}`
      Object.assign(health, { state: 'healthy', generation: generation.value, token: crypto.randomUUID() })
      emptied = false
      return {
        value: {
          exitCode: 0,
          stdout: JSON.stringify({ projectId, generation: generation.value, moved }),
          stderr: '',
        },
      }
    }
    if (argv[0] === helperPath && argv[1] === 'archive-status') {
      if (options.statusFails) return refuse(options.statusFails)
      return {
        value: {
          exitCode: 0,
          stdout: JSON.stringify({
            projectId,
            generation: emptied && archive.length === 0 && staged.size === 0 ? null : generation.value,
            quarantineUnderway: options.quarantineUnderway?.value
              ?? options.quarantineFails === 'quarantine-failed',
            clearUnderway: options.clearUnderway?.value === true,
            clearRunUnderway: options.clearRunUnderway?.value === true,
            integrityGaps: archive.filter(row => row.kind === 'integrity-gap').length,
            liveRuns: options.liveRuns ?? [],
            quarantined,
            archiveBytes: options.archiveBytes ?? 0,
          }),
          stderr: '',
        },
      }
    }
    throw new Error(`unexpected process: ${argv.join(' ')}`)
  })
  on('prompt.submit', async (_$, e) => {
    if (options.duringSubmit) await options.duringSubmit()
    if (options.dropBeneath !== undefined) return { drop: options.dropBeneath }
    const text = options.rewrite ? FINAL_SECRET : e.text
    options.transcript?.push({ role: 'user', text })
    return { text, context: e.context, origin: e.origin }
  })
  return calls
}

/* A helper subcommand that failed with a category, as the helper exits:
   damage it met names the generation it met it in. */
function failure(category: boolean | string, generation?: string) {
  const named = category === true ? 'archive-sqlite' : category
  return {
    value: {
      exitCode: 25,
      stdout: '',
      stderr: JSON.stringify({
        category: named,
        ...(named === 'archive-integrity' && generation ? { generation } : {}),
      }),
    },
  }
}

export function captureCalls(calls: readonly ProcessCall[], command: string) {
  return calls.filter(call => call.argv[1] === command)
}

const RUN_BOUNDARIES = new Set(['run-started', 'run-attached', 'run-detached'])

/* The segment and collection boundaries a test is asking about. A Run's own
   boundaries are appended through the same subcommand; the tests that are
   about them ask for them by kind. */
export function boundaryCalls(calls: readonly ProcessCall[]) {
  return captureCalls(calls, 'boundary-append')
    .filter(call => !RUN_BOUNDARIES.has(call.argv[7] ?? ''))
}

export function composerPrompt(
  $: import('claude-code/testing').Engine,
  input: {
    text?: string
    attachments?: readonly PromptAttachment[]
    origin?: PromptOrigin
  } = {},
) {
  return $.prompt.submit({
    text: input.text ?? SECRET,
    wait: false,
    origin: input.origin ?? { kind: 'composer' },
    ...(input.attachments ? { attachments: input.attachments } : {}),
  })
}

export async function promptHistory(
  $: import('claude-code/testing').Engine,
  args = '',
) {
  return $.command.run({
    command: 'prompt-history',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 80 },
  })
}

export const BAND_ID = 'prompt-trail-band'

/* Draws the band. `scroll` places the engine's window over a tree taller than
   `maxRows`; by default it sits at the top. `bodyColumns` is the band's width,
   and `hasSurvey` a survey holding it. */
export async function renderBand(
  $: import('claude-code/testing').Engine,
  view: { maxRows?: number; offset?: number; bodyColumns?: number; hasSurvey?: boolean } = {},
) {
  const maxRows = view.maxRows ?? 12
  return $.ui.render({
    component: 'AbovePrompt',
    surface: 'terminal',
    requestId: BAND_ID,
    viewport: { columns: 80, rows: 24 },
    props: {
      hasSurvey: view.hasSurvey ?? false,
      isWorking: false,
      maxRows,
      bodyColumns: view.bodyColumns ?? 80,
      scroll: { offset: view.offset ?? 0, bodyRows: maxRows - 1 },
      view: {},
    },
  })
}

/* The Pane Prompt Trail asks the person in when a transcript cannot place the
   next prompt's parent. */
export const PARENT_PANE_ID = 'prompt-trail-parent'
const PARENT_KEY_PREFIX = 'prompt-trail:parent:'

/* Every `$.ui.open` of that Pane, the order in which it opened, closed and the
   draft was written back, and every toast. `clock` settles what a choice left
   running. */
export type ParentPane = {
  opens: Record<string, unknown>[]
  log: string[]
  toasts: string[]
  /* Another hook refuses to open it. */
  refused?: true
  clock?: import('claude-code/testing').MockClock
}

export function parentPane(): ParentPane {
  return { opens: [], log: [], toasts: [] }
}

export async function renderParentPane(
  $: import('claude-code/testing').Engine,
  bodyColumns = 60,
) {
  return $.ui.render({
    component: 'Pane',
    surface: 'terminal',
    requestId: PARENT_PANE_ID,
    viewport: { columns: 80, rows: 24 },
    props: {
      title: '确认父节点',
      isFocused: true,
      bodyColumns,
      placement: 'inline',
      scroll: { offset: 0, bodyRows: 12 },
      view: {},
    },
  })
}

type Drawn = { type?: string; props?: Record<string, unknown>; children?: unknown }

function buttonsIn(tree: unknown): Record<string, unknown>[] {
  if (Array.isArray(tree)) return tree.flatMap(buttonsIn)
  if (!tree || typeof tree !== 'object') return []
  const node = tree as Drawn
  if (node.type === 'Button' && node.props) return [node.props]
  return buttonsIn(node.children)
}

/* The candidates the Pane offers, as the person reads them. */
export async function parentChoices($: import('claude-code/testing').Engine): Promise<string[]> {
  return buttonsIn(await renderParentPane($))
    .filter(button => String(button.key).startsWith(PARENT_KEY_PREFIX))
    .map(button => String(button.label))
}

/* Presses the candidate `pick` names among the Pane's labels, as Enter or a
   click would, and lets what the press left running finish. */
export async function pickParent(
  $: import('claude-code/testing').Engine,
  pane: ParentPane,
  pick: (labels: string[]) => string | undefined,
): Promise<void> {
  const buttons = buttonsIn(await renderParentPane($))
    .filter(button => String(button.key).startsWith(PARENT_KEY_PREFIX))
  const label = pick(buttons.map(button => String(button.label)))
  const chosen = buttons.find(button => button.label === label)
  if (!chosen) throw new Error(`no parent candidate labelled ${label}`)
  await $.ui.press({ plugin: 'prompt-trail', key: String(chosen.key), requestId: PARENT_PANE_ID })
  await pane.clock?.settle()
}
