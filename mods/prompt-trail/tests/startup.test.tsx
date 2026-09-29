import { expect, mock, test } from 'claude-code/testing'
import { EXPECTED_HELPER_SHA256, HELPER_PROTOCOL } from '../hooks/artifact'

const session = {
  cwd: '/tmp/prompt-trail-project',
  surface: 'terminal' as const,
  isInteractive: true,
}

const abovePrompt = {
  component: 'AbovePrompt' as const,
  surface: 'terminal' as const,
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
}

test('starts collapsed with only the Prompt Trail title', async ($, on) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('ui.render', () => ({ type: 'engine', ref: 0 }))

  await $.session.start(session)

  const tree = await $.ui.render(abovePrompt)

  expect(tree).toMatchObject({
    type: 'Button',
    props: {
      key: 'prompt-trail:toggle',
      plain: true,
      label: '▸ Prompt Trail',
    },
  })
})

test('reports unsupported target without touching an archive', async ($, on) => {
  const processCalls: string[][] = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('process.run', (_$, e) => {
    processCalls.push([...e.argv])
    const value = e.argv[1] === '-s'
      ? { exitCode: 0, stdout: 'Linux\n', stderr: '' }
      : { exitCode: 0, stdout: '', stderr: '' }
    return { value }
  })

  await $.session.start(session)
  const result = await $.command.run({
    command: 'prompt-history',
    args: 'status',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 80 },
  })

  expect(result.text).toContain('support: unsupported target')
  expect(result.text).toContain('reason: operating-system')
  expect(result.text).toContain('collection consent: not granted')
  expect(result.text).toContain(
    'not promised: 其他平台与 surface · Marketplace 安装与卸载 · 自动焦点、Esc 折叠、触控板与滚轮、槽位仲裁 · 删除不触及 transcript 与外部副本 · 移除 --plugin-dir 前先清除（见 README）',
  )
  expect(result.text).not.toContain('PT-SECRET-MARKER')
  expect(processCalls).toStrictEqual([
    ['/usr/bin/uname', '-s'],
    ['/usr/bin/uname', '-s'],
  ])
})

test('reports supported only after the trusted read-only preflight succeeds', async ($, on) => {
  const home = '/Users/tester'
  const sessionId = '11111111-2222-4333-8444-555555555555'
  let activeSessionId = sessionId
  let transientClearLocatorMode = true
  const pluginRoot = '/opt/prompt-trail'
  const pluginData = '/Users/tester/.claude/plugins/data/prompt-trail-inline'
  const helperPath = `${pluginRoot}/bin/prompt-trail-helper`
  const manifestPath = `${pluginRoot}/artifacts/helper-manifest.json`
  const databaseRoot = `${pluginData}/archives`
  const locatorDirectory = `${home}/.claude/plugins/data/.function-hook-locators/prompt-trail`
  const locatorPath = `${locatorDirectory}/${sessionId}.4242-100-200.json`
  const locatorReads: string[] = []
  const runId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
  const archiveGeneration = '99999999-8888-4777-8666-555555555555'
  const locator = {
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
  }
  const processCalls: string[][] = []

  mock.env(on, { HOME: home })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: activeSessionId }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('fs.list', (_$, e) => ({
    value: e.path === locatorDirectory
      ? [{ name: `${activeSessionId}.4242-100-200.json`, kind: 'file' as const, size: 1 }]
      : [],
  }))
  on('fs.read', (_$, e) => {
    const activeLocatorPath = `${locatorDirectory}/${activeSessionId}.4242-100-200.json`
    if (e.path !== activeLocatorPath) throw new Error(`unexpected read: ${e.path}`)
    locatorReads.push(e.path)
    return { value: JSON.stringify({ ...locator, sessionId: activeSessionId }) }
  })
  on('process.run', (_$, e) => {
    const argv = [...e.argv]
    processCalls.push(argv)
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
      const activeLocatorPath = `${locatorDirectory}/${activeSessionId}.4242-100-200.json`
      const directory = path === locatorDirectory
        || path === pluginData
        || path === pluginRoot
        || path === `${pluginRoot}/bin`
        || path === `${pluginRoot}/artifacts`
      const transientMode = path === activeLocatorPath
        && activeSessionId !== sessionId
        && transientClearLocatorMode
      if (transientMode) transientClearLocatorMode = false
      return {
        value: {
          exitCode: 0,
          stdout: `${directory ? 'Directory' : 'Regular File'}|501|${directory ? '700' : path === activeLocatorPath ? transientMode ? '644' : '600' : '755'}\n`,
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
    if (argv[0] === helperPath && argv[1] === 'preflight') {
      return {
        value: {
          exitCode: 0,
          stdout: JSON.stringify({
            status: 'supported',
            artifactStatus: 'trusted',
            sessionId: activeSessionId,
            runId,
            archiveGeneration,
            databaseRoot,
            helperPath,
            helperProtocol: HELPER_PROTOCOL,
            macosVersion: '15.8',
            sqliteVersionNumber: 3049001,
            sqliteReturning: true,
          }),
          stderr: '',
        },
      }
    }
    throw new Error(`unexpected process: ${argv.join(' ')}`)
  })

  await $.session.start(session)
  const result = await $.command.run({
    command: 'prompt-history',
    args: 'status',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 80 },
  })

  expect(result.text).toContain('support: supported')
  expect(result.text).toContain('helper: trusted')
  expect(result.text).toContain(`database root: ${databaseRoot}`)
  expect(result.text).toContain('archive: not created')
  expect(processCalls.some(argv => argv[0] === helperPath && argv[1] === 'preflight')).toBe(true)
  expect(processCalls.some(argv => argv.includes('create'))).toBe(false)

  activeSessionId = '22222222-3333-4444-8555-666666666666'
  const afterClear = await $.command.run({
    command: 'prompt-history',
    args: 'status',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 80 },
  })

  expect(afterClear.text).toContain('support: supported')
  expect(locatorReads).toContain(`${locatorDirectory}/${activeSessionId}.4242-100-200.json`)
})
