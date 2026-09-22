import type { On, PromptAttachment, PromptOrigin } from 'claude-code'
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
export const locatorPath = `${locatorDirectory}/${sessionId}.json`
export const session = {
  cwd: projectRoot,
  surface: 'terminal' as const,
  isInteractive: true,
}

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
  abortFails?: boolean
  boundaryFails?: boolean
  /* Any store key containing this substring throws on read. */
  storeGetFailsFor?: string
  /* Runs while a composer submission is inside the downstream hook. */
  duringSubmit?: () => Promise<void>
}

/* Prompt Entries and Collection Boundaries share one project-level sequence,
   so the mock allocates from a single counter the way the helper does. */
function nextSequence(calls: readonly ProcessCall[]): number {
  return calls.filter(call => (
    call.argv[1] === 'capture-confirm' || call.argv[1] === 'boundary-append'
  )).length
}

export function installSupportedTarget(
  on: On,
  options: TargetOptions = {},
): ProcessCall[] {
  const calls: ProcessCall[] = []
  mock.env(on, { HOME: home })
  mock.clock(on, { now: 1_795_000_000_000 })
  if (options.storeSetFails) {
    on('store.get', () => ({ value: undefined }))
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
      store[e.key] = e.value
      return { value: undefined }
    })
    on('store.delete', (_$, e) => {
      delete store[e.key]
      return { value: undefined }
    })
  } else {
    mock.store(on, options.consent === undefined
      ? undefined
      : { [`prompt-trail:consent:${projectId}`]: options.consent })
  }
  on('fs.exists', () => ({ value: options.hasGitDirectory ?? false }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: sessionId }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('fs.read', () => ({
    value: JSON.stringify({
      locatorVersion: 1,
      pluginProtocol: 1,
      helperProtocol: HELPER_PROTOCOL,
      sessionId,
      hostPid: 4242,
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
      runId,
      archiveGeneration,
    }),
  }))
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    const question = e.questions[0]?.question ?? ''
    return {
      result: {
        questions: e.questions,
        answers: { [question]: options.ask ?? '启用' },
      },
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
          stdout: `${directory ? 'Directory' : 'Regular File'}|501|${directory ? '700' : path === locatorPath ? '600' : '755'}\n`,
          stderr: '',
        },
      }
    }
    if (argv[0] === '/usr/bin/shasum') {
      return {
        value: {
          exitCode: 0,
          stdout: `${EXPECTED_HELPER_SHA256}  ${helperPath}\n`,
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
            sessionId,
            runId,
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
      if (options.confirmFails) {
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
            eventId,
            projectId,
            sequence: nextSequence(calls),
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
      return {
        value: {
          exitCode: 0,
          stdout: JSON.stringify({
            eventId: argv[8],
            projectId,
            kind: argv[7],
            sequence: nextSequence(calls),
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
      return { value: { exitCode: 0, stdout: '{"aborted":true}', stderr: '' } }
    }
    throw new Error(`unexpected process: ${argv.join(' ')}`)
  })
  on('prompt.submit', async (_$, e) => {
    if (options.duringSubmit) await options.duringSubmit()
    return options.dropBeneath === undefined
      ? {
          text: options.rewrite ? FINAL_SECRET : e.text,
          context: e.context,
          origin: e.origin,
        }
      : { drop: options.dropBeneath }
  })
  return calls
}

export function captureCalls(calls: readonly ProcessCall[], command: string) {
  return calls.filter(call => call.argv[1] === command)
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
