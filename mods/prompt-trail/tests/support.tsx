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
  confirmFails?: boolean
  /* Fails only the first confirmation, so a later reconciliation can land. */
  confirmFailsOnce?: boolean
  beginFails?: boolean
  abortFails?: boolean
  boundaryFails?: boolean
  listFails?: boolean
  /* What `capture-list` answers: the pendings the archive still holds. A
     resolved one is dropped from the front, the way the archive would. */
  pendingList?: Record<string, unknown>[]
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
  branchMatchFails?: boolean
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
  readFails?: boolean
  run?: RunIdentity
  /* The session the locator says this one continues: the conversation was
     moved here from it, and this session took up its Run. */
  continuedFrom?: string
  /* Whether the bridge has published this session's locator yet; a session
     the host started a moment ago may run its hooks before it has. */
  locatorPublished?: { value: boolean }
  /* Hands the test the mocked clock, to move it past a wait. */
  onClock?: (clock: import('claude-code/testing').MockClock) => void
  /* The digest `shasum` reports for the helper file right now. */
  helperDigest?: { value: string }
}

/* The helper's fixed read batch. */
export const TIMELINE_READ_LIMIT = 128

/* Prompt Entries and every kind of boundary share one project-level sequence,
   and the helper allocates it once per event id: a repeat answers the stored
   sequence rather than a second one, and a rolled-back write allocates none. */
function sequenceAllocator(archive: readonly ArchiveRow[]): (eventId: string) => number {
  const allocated = new Map<string, number>(archive.map(row => [row.eventId, row.sequence]))
  let next = archive.reduce((highest, row) => Math.max(highest, row.sequence), 0)
  return eventId => {
    const existing = allocated.get(eventId)
    if (existing !== undefined) return existing
    next += 1
    allocated.set(eventId, next)
    return next
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
  const allocateSequence = sequenceAllocator(archive)
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
      return { value: undefined }
    })
    on('store.delete', (_$, e) => {
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
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    const question = e.questions[0]?.question ?? ''
    const choices = e.questions[0]?.options ?? []
    const labels = choices.map(choice => (typeof choice === 'string' ? choice : choice.label))
    const isReconcile = labels.includes('已进入')
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
    if (argv[0] === '/usr/bin/git') {
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
    if (argv[0] === helperPath && argv[1] === 'capture-begin') {
      const eventId = argv[8]
      if (options.beginFails) {
        return {
          value: {
            exitCode: 25,
            stdout: '',
            stderr: '{"category":"archive-sqlite"}',
          },
        }
      }
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
          stdout: JSON.stringify({ eventId, projectId, pending: true }),
          stderr: '',
        },
      }
    }
    if (argv[0] === helperPath && argv[1] === 'capture-confirm') {
      const eventId = argv[4]
      const isFirstConfirm =
        calls.filter(call => call.argv[1] === 'capture-confirm').length === 1
      if (options.confirmFails || (options.confirmFailsOnce && isFirstConfirm)) {
        return {
          value: {
            exitCode: 25,
            stdout: '',
            stderr: '{"category":"archive-sqlite"}',
          },
        }
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
          }),
          stderr: '',
        },
      }
    }
    if (argv[0] === helperPath && argv[1] === 'boundary-append') {
      if (options.boundaryFails) {
        return {
          value: {
            exitCode: 25,
            stdout: '',
            stderr: '{"category":"archive-sqlite"}',
          },
        }
      }
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
        return {
          value: {
            exitCode: 25,
            stdout: '',
            stderr: '{"category":"archive-sqlite"}',
          },
        }
      }
      const ordered = [...archive].sort((left, right) => left.sequence - right.sequence)
      const latest = ordered.slice(-TIMELINE_READ_LIMIT)
      return {
        value: {
          exitCode: 0,
          stdout: JSON.stringify({
            projectId,
            events: latest.map(row => ({
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
                  }
                : {}),
            })),
            truncated: ordered.length > latest.length,
          }),
          stderr: '',
        },
      }
    }
    if (argv[0] === helperPath && argv[1] === 'branch-match') {
      if (options.branchMatchFails) {
        return {
          value: {
            exitCode: 25,
            stdout: '',
            stderr: '{"category":"archive-sqlite"}',
          },
        }
      }
      const call = calls[calls.length - 1]!
      const answer = typeof options.branchMatch === 'function'
        ? options.branchMatch(call)
        : options.branchMatch ?? { match: 'none', candidates: [], candidateCount: 0 }
      return {
        value: { exitCode: 0, stdout: JSON.stringify({ projectId, ...answer }), stderr: '' },
      }
    }
    if (argv[0] === helperPath && argv[1] === 'capture-list') {
      if (options.listFails) {
        return {
          value: {
            exitCode: 25,
            stdout: '',
            stderr: '{"category":"archive-sqlite"}',
          },
        }
      }
      return {
        value: {
          exitCode: 0,
          stdout: JSON.stringify({
            projectId,
            pending: options.pendingList ?? [],
            truncated: false,
          }),
          stderr: '',
        },
      }
    }
    if (argv[0] === helperPath && argv[1] === 'capture-abort') {
      if (options.abortFails) {
        return {
          value: {
            exitCode: 25,
            stdout: '',
            stderr: '{"category":"archive-sqlite"}',
          },
        }
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

export async function renderBand($: import('claude-code/testing').Engine) {
  return $.ui.render({
    component: 'AbovePrompt',
    surface: 'terminal',
    requestId: 'prompt-trail-band',
    viewport: { columns: 80, rows: 24 },
    props: {
      hasSurvey: false,
      isWorking: false,
      maxRows: 12,
      bodyColumns: 80,
      scroll: { offset: 0, bodyRows: 12 },
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
