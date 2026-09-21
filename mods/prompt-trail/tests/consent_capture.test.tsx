import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { EXPECTED_HELPER_SHA256, HELPER_PROTOCOL } from '../hooks/artifact'

const SECRET = 'PT-SECRET-CONSENT-CAPTURE\nsecond line'
const FINAL_SECRET = 'PT-SECRET-FINAL-CAPTURE\nsecond line'
const projectRoot = '/tmp/prompt-trail-project'
const projectId = '2f8f609b94d1dceb67370dea36cf1d5e5a9cd5dc909d3a0673cbc45b69ea1796'
const sessionId = '11111111-2222-4333-8444-555555555555'
const runId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const archiveGeneration = '99999999-8888-4777-8666-555555555555'
const home = '/Users/tester'
const pluginRoot = '/opt/prompt-trail'
const pluginData = '/Users/tester/.claude/plugins/data/prompt-trail-inline'
const helperPath = `${pluginRoot}/bin/prompt-trail-helper`
const manifestPath = `${pluginRoot}/artifacts/helper-manifest.json`
const databaseRoot = `${pluginData}/archives`
const databasePath = `${databaseRoot}/${projectId}.sqlite3`
const locatorDirectory = `${home}/.claude/plugins/data/.function-hook-locators/prompt-trail`
const locatorPath = `${locatorDirectory}/${sessionId}.json`
const session = {
  cwd: projectRoot,
  surface: 'terminal' as const,
  isInteractive: true,
}

type ProcessCall = {
  argv: string[]
  stdin?: string
}

type TargetOptions = {
  ask?: '启用' | '继续但不启用'
  consent?: unknown
  rewrite?: boolean
  storeSetFails?: boolean
  store?: Record<string, unknown>
  gitExitCode?: number
  hasGitDirectory?: boolean
  preflightThrows?: boolean
  confirmFails?: boolean
}

function installSupportedTarget(on: On, options: TargetOptions = {}): ProcessCall[] {
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
    on('store.get', (_$, e) => ({ value: store[e.key] }))
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
          stdout: JSON.stringify({ eventId, projectId, sequence: 1 }),
          stderr: '',
        },
      }
    }
    if (argv[0] === helperPath && argv[1] === 'capture-abort') {
      return { value: { exitCode: 0, stdout: '{"aborted":true}', stderr: '' } }
    }
    throw new Error(`unexpected process: ${argv.join(' ')}`)
  })
  on('prompt.submit', (_$, e) => ({
    text: options.rewrite ? FINAL_SECRET : e.text,
    context: e.context,
    origin: e.origin,
  }))
  return calls
}

function composerPrompt($: import('claude-code/testing').Engine) {
  return $.prompt.submit({
    text: SECRET,
    wait: false,
    origin: { kind: 'composer' },
  })
}

test('declining consent lets the prompt enter without creating archive state', async ($, on) => {
  const calls = installSupportedTarget(on, { ask: '继续但不启用' })
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(result).toMatchObject({ text: SECRET })
  expect(calls.some(call => call.argv[1]?.startsWith('capture-'))).toBe(false)
  expect(calls.some(call => call.argv.includes(databasePath))).toBe(false)
  const status = await $.command.run({
    command: 'prompt-history',
    args: 'status',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 80 },
  })
  expect(status.text).toContain('collection consent: declined')
  expect(status.text).toContain('archive: not created')
})

test('enabled consent stages through stdin and confirms the final prompt atomically', async ($, on) => {
  const calls = installSupportedTarget(on, { ask: '启用', rewrite: true })
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(result).toMatchObject({ text: FINAL_SECRET })
  const begin = calls.find(call => call.argv[1] === 'capture-begin')
  const confirm = calls.find(call => call.argv[1] === 'capture-confirm')
  expect(begin?.stdin).toBe(SECRET)
  expect(confirm?.stdin).toBe(FINAL_SECRET)
  expect(begin?.argv).not.toContain(SECRET)
  expect(begin?.argv).not.toContain(FINAL_SECRET)
  expect(confirm?.argv).not.toContain(SECRET)
  expect(confirm?.argv).not.toContain(FINAL_SECRET)
  expect(JSON.stringify(calls.map(call => call.argv))).not.toContain('PT-SECRET')

  const status = await $.command.run({
    command: 'prompt-history',
    args: 'status',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 80 },
  })
  expect(status.text).toContain('collection consent: granted · policy 1')
  expect(status.text).toContain('Run collection mode: enabled')
  expect(status.text).toContain(`archive: ready · ${databasePath}`)
  expect(status.text).not.toContain('PT-SECRET')
})

test('stored current-policy consent survives reload without another question', async ($, on) => {
  const calls = installSupportedTarget(on, {
    consent: { policyVersion: 1, decision: 'enabled' },
  })
  let questions = 0
  on('tool.call', { tool: 'AskUserQuestion' }, () => {
    questions += 1
    throw new Error('must not ask')
  })
  await $.session.start(session)

  await composerPrompt($)

  expect(questions).toBe(0)
  expect(calls.some(call => call.argv[1] === 'capture-confirm')).toBe(true)
})

test('an older consent policy asks again before collection', async ($, on) => {
  const calls = installSupportedTarget(on, {
    ask: '继续但不启用',
    consent: { policyVersion: 0, decision: 'enabled' },
  })
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(result).toMatchObject({ text: SECRET })
  expect(calls.some(call => call.argv[1]?.startsWith('capture-'))).toBe(false)
})

test('bare prompt-history expands and renders the confirmed first entry', async ($, on) => {
  installSupportedTarget(on, { ask: '启用' })
  await $.session.start(session)
  await composerPrompt($)

  const command = await $.command.run({
    command: 'prompt-history',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 80 },
  })
  expect(command.text).toContain('Prompt Trail 已展开')

  const tree = await $.ui.render({
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
  const rendered = JSON.stringify(tree)
  expect(rendered).toContain('▾ Prompt Trail')
  expect(rendered).toContain(`1. ${SECRET.replace('\n', ' ↵ ')}`)
  expect(rendered).not.toContain('2. ')
})

test('a failed preflight blocks submission once collection is enabled', async ($, on) => {
  const calls = installSupportedTarget(on, {
    consent: { policyVersion: 1, decision: 'enabled' },
    preflightThrows: true,
  })
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(result).toMatchObject({ drop: expect.any(String) })
  expect(result.text).toBe(undefined)
  expect(JSON.stringify(result)).not.toContain('PT-SECRET')
  expect(calls.some(call => call.argv[1]?.startsWith('capture-'))).toBe(false)
})

test('an unprovable project root blocks submission once collection is enabled', async ($, on) => {
  const calls = installSupportedTarget(on, {
    consent: { policyVersion: 1, decision: 'enabled' },
    gitExitCode: 128,
    hasGitDirectory: true,
  })
  await $.session.start(session)

  const first = await composerPrompt($)
  expect(first).toMatchObject({ text: SECRET })
  expect(calls.some(call => call.argv[1]?.startsWith('capture-'))).toBe(false)

  const second = await composerPrompt($)
  expect(second).toMatchObject({ text: SECRET })
  expect(calls.some(call => call.argv[1]?.startsWith('capture-'))).toBe(false)
})

test('a confirmation failure keeps collection blocked across a reload', async ($, on) => {
  const store: Record<string, unknown> = {
    [`prompt-trail:consent:${projectId}`]: { policyVersion: 1, decision: 'enabled' },
  }
  const calls = installSupportedTarget(on, { store, confirmFails: true })
  await $.session.start(session)

  const first = await composerPrompt($)
  expect(first).toMatchObject({ text: SECRET })
  expect(calls.some(call => call.argv[1] === 'capture-confirm')).toBe(true)

  const blocked = await composerPrompt($)
  expect(blocked).toMatchObject({ drop: expect.any(String) })
  expect(store[`prompt-trail:archive-state:${projectId}`])
    .toStrictEqual({ version: 1, state: 'unavailable' })
})

test('a store write failure never blocks a prompt the person declined to collect', async ($, on) => {
  const calls = installSupportedTarget(on, {
    ask: '继续但不启用',
    storeSetFails: true,
  })
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(result).toMatchObject({ text: SECRET })
  expect(JSON.stringify(result)).not.toContain('PT-SECRET-STORE')
  expect(calls.some(call => call.argv[1]?.startsWith('capture-'))).toBe(false)
})
