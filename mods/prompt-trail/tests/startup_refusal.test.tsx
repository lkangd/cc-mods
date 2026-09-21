import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { EXPECTED_HELPER_SHA256, HELPER_PROTOCOL } from '../hooks/artifact'

const session = {
  cwd: '/tmp/prompt-trail-project',
  surface: 'terminal' as const,
  isInteractive: true,
}
const home = '/Users/tester'
const sessionId = '11111111-2222-4333-8444-555555555555'
const pluginRoot = '/opt/prompt-trail'
const pluginData = '/Users/tester/.claude/plugins/data/prompt-trail-inline'
const helperPath = `${pluginRoot}/bin/prompt-trail-helper`
const manifestPath = `${pluginRoot}/artifacts/helper-manifest.json`
const databaseRoot = `${pluginData}/archives`
const locatorPath = `${home}/.claude/plugins/data/.function-hook-locators/prompt-trail/${sessionId}.json`
const locatorDirectory = locatorPath.slice(0, locatorPath.lastIndexOf('/'))

function locator(overrides: Record<string, unknown> = {}) {
  return {
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
    runId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    archiveGeneration: '99999999-8888-4777-8666-555555555555',
    ...overrides,
  }
}

function installTarget(
  on: On,
  options: {
    locator?: Record<string, unknown>
    locatorReadFails?: boolean
    locatorMode?: string
    locatorAcl?: boolean
    locatorDirectoryAcl?: boolean
    helperKind?: string
    helperMode?: string
    helperStatFails?: boolean
    manifestMode?: string
    manifestStatFails?: boolean
    actualDigest?: string
    helperFailure?: { exitCode: number; stderr: string }
    helperThrows?: boolean
  } = {},
): string[][] {
  const processCalls: string[][] = []
  mock.env(on, { HOME: home })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: sessionId }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('fs.read', () => {
    if (options.locatorReadFails) throw new Error('missing locator: PT-SECRET-MARKER')
    return { value: JSON.stringify(options.locator ?? locator()) }
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
      const path = argv[argv.length - 1]
      const hasAcl = path === locatorPath
        ? options.locatorAcl
        : path === locatorDirectory
          ? options.locatorDirectoryAcl
          : false
      const acl = hasAcl ? ' 0: group:everyone allow read\n' : ''
      return { value: { exitCode: 0, stdout: `private path\n${acl}`, stderr: '' } }
    }
    if (argv[0] === '/bin/realpath') {
      return { value: { exitCode: 0, stdout: `${argv[1]}\n`, stderr: '' } }
    }
    if (argv[0] === '/usr/bin/stat') {
      const path = argv[argv.length - 1]
      if ((path === helperPath && options.helperStatFails)
          || (path === manifestPath && options.manifestStatFails)) {
        return { value: { exitCode: 1, stdout: '', stderr: 'PT-SECRET-MARKER' } }
      }
      const directory = path === locatorDirectory
        || path === pluginData
        || path === pluginRoot
        || path === `${pluginRoot}/bin`
        || path === `${pluginRoot}/artifacts`
      const kind = path === helperPath
        ? options.helperKind ?? 'Regular File'
        : directory
          ? 'Directory'
          : 'Regular File'
      const mode = path === locatorPath
        ? options.locatorMode ?? '600'
        : directory
          ? '700'
          : path === helperPath
            ? options.helperMode ?? '755'
            : path === manifestPath
              ? options.manifestMode ?? '644'
              : '644'
      return { value: { exitCode: 0, stdout: `${kind}|501|${mode}\n`, stderr: '' } }
    }
    if (argv[0] === '/usr/bin/shasum') {
      return {
        value: {
          exitCode: 0,
          stdout: `${options.actualDigest ?? EXPECTED_HELPER_SHA256}  ${helperPath}\n`,
          stderr: '',
        },
      }
    }
    if (argv[0] === helperPath && argv[1] === 'preflight') {
      if (options.helperThrows) throw new Error('execution denied: PT-SECRET-MARKER')
      if (options.helperFailure) {
        return {
          value: {
            exitCode: options.helperFailure.exitCode,
            stdout: '',
            stderr: options.helperFailure.stderr,
          },
        }
      }
      return {
        value: {
          exitCode: 0,
          stdout: JSON.stringify({
            status: 'supported',
            artifactStatus: 'trusted',
            sessionId,
            runId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            archiveGeneration: '99999999-8888-4777-8666-555555555555',
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
  return processCalls
}

async function status(
  $: import('claude-code/testing').Engine,
  start = session,
) {
  await $.session.start(start)
  return $.command.run({
    command: 'prompt-history',
    args: 'status',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 80 },
  })
}

test('rejects a non-interactive session without probing the host', async ($, on) => {
  const calls: string[][] = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('process.run', (_$, e) => {
    calls.push([...e.argv])
    throw new Error('must not run')
  })

  const result = await status($, { ...session, isInteractive: false })

  expect(result.text).toContain('support: unsupported target')
  expect(result.text).toContain('reason: interactive-terminal')
  expect(calls).toStrictEqual([])
})

test('reports an unprovable operating system as unsupported', async ($, on) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('process.run', () => {
    throw new Error('PT-SECRET-MARKER')
  })

  const result = await status($)

  expect(result.text).toContain('support: unsupported target')
  expect(result.text).toContain('reason: operating-system-unproven')
  expect(result.text).not.toContain('PT-SECRET-MARKER')
})

test('rejects a non-arm64 host before reading a locator', async ($, on) => {
  const calls: string[][] = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('process.run', (_$, e) => {
    const argv = [...e.argv]
    calls.push(argv)
    return {
      value: {
        exitCode: 0,
        stdout: argv[1] === '-s' ? 'Darwin\n' : 'x86_64\n',
        stderr: '',
      },
    }
  })

  const result = await status($)

  expect(result.text).toContain('support: unsupported target')
  expect(result.text).toContain('reason: architecture')
  expect(calls).toStrictEqual([
    ['/usr/bin/uname', '-s'],
    ['/usr/bin/uname', '-m'],
    ['/usr/bin/uname', '-s'],
    ['/usr/bin/uname', '-m'],
  ])
})

test('rejects a non-macOS-15 host before reading a locator', async ($, on) => {
  const calls: string[][] = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('process.run', (_$, e) => {
    const argv = [...e.argv]
    calls.push(argv)
    const stdout = argv[1] === '-s'
      ? 'Darwin\n'
      : argv[1] === '-m'
        ? 'arm64\n'
        : '16.0\n'
    return { value: { exitCode: 0, stdout, stderr: '' } }
  })

  const result = await status($)

  expect(result.text).toContain('support: unsupported target')
  expect(result.text).toContain('reason: macos-major-version')
  expect(calls).toStrictEqual([
    ['/usr/bin/uname', '-s'],
    ['/usr/bin/uname', '-m'],
    ['/usr/bin/sw_vers', '-productVersion'],
    ['/usr/bin/uname', '-s'],
    ['/usr/bin/uname', '-m'],
    ['/usr/bin/sw_vers', '-productVersion'],
  ])
})

test('reports an unproven Claude Code version when the locator is absent', async ($, on) => {
  const calls = installTarget(on, { locatorReadFails: true })

  const result = await status($)

  expect(result.text).toContain('support: unsupported target')
  expect(result.text).toContain('reason: claude-code-version-unproven')
  expect(result.text).not.toContain('PT-SECRET-MARKER')
  expect(calls.some(argv => argv[0] === helperPath)).toBe(false)
})

test('rejects a Claude Code version below the supported minimum', async ($, on) => {
  const calls = installTarget(on, {
    locator: locator({ hostVersion: '2.1.272' }),
  })

  const result = await status($)

  expect(result.text).toContain('support: unsupported target')
  expect(result.text).toContain('reason: claude-code-version')
  expect(result.text).toContain('Claude Code 2.1.272')
  expect(result.text).toContain('helper: not checked')
  expect(calls.some(argv => argv[0] === helperPath)).toBe(false)
})

test('reports a malformed Claude Code version as unproven', async ($, on) => {
  const calls = installTarget(on, {
    locator: locator({ hostVersion: 'unproven' }),
  })

  const result = await status($)

  expect(result.text).toContain('support: unsupported target')
  expect(result.text).toContain('reason: claude-code-version-unproven')
  expect(calls.some(argv => argv[0] === helperPath)).toBe(false)
})

test('reports SQLite capability failure without helper diagnostics', async ($, on) => {
  const calls = installTarget(on, {
    helperFailure: {
      exitCode: 24,
      stderr: '{"category":"sqlite-capability","detail":"PT-SECRET-MARKER"}',
    },
  })

  const result = await status($)

  expect(result.text).toContain('support: helper unavailable')
  expect(result.text).toContain('reason: sqlite-capability')
  expect(result.text).not.toContain('PT-SECRET-MARKER')
  expect(calls.some(argv => argv[0] === helperPath && argv[1] === 'preflight')).toBe(true)
})

for (const category of [
  'database-root-unavailable',
  'helper-path-unproven',
  'home-unavailable',
] as const) {
  test(`preserves safe helper category ${category}`, async ($, on) => {
    installTarget(on, {
      helperFailure: {
        exitCode: 25,
        stderr: JSON.stringify({ category, detail: 'PT-SECRET-MARKER' }),
      },
    })

    const result = await status($)

    expect(result.text).toContain('support: helper unavailable')
    expect(result.text).toContain(`reason: ${category}`)
    expect(result.text).not.toContain('PT-SECRET-MARKER')
  })
}

test('reports system execution refusal without leaking its error', async ($, on) => {
  installTarget(on, { helperThrows: true })

  const result = await status($)

  expect(result.text).toContain('support: helper unavailable')
  expect(result.text).toContain('reason: execution-refused')
  expect(result.text).not.toContain('PT-SECRET-MARKER')
})

test('sanitizes a non-JSON helper execution refusal', async ($, on) => {
  installTarget(on, {
    helperFailure: {
      exitCode: 126,
      stderr: 'dyld blocked PT-SECRET-MARKER',
    },
  })

  const result = await status($)

  expect(result.text).toContain('support: helper unavailable')
  expect(result.text).toContain('reason: execution-refused')
  expect(result.text).not.toContain('PT-SECRET-MARKER')
})

test('rejects a widened locator before trusting its artifact status', async ($, on) => {
  const calls = installTarget(on, {
    locator: locator({ artifactStatus: 'helper-missing' }),
    locatorMode: '644',
  })

  const result = await status($)

  expect(result.text).toContain('support: unsupported target')
  expect(result.text).toContain('reason: locator-permissions')
  expect(result.text).not.toContain(`helper: unavailable · ${helperPath}`)
  expect(calls.some(argv => argv[0] === helperPath)).toBe(false)
})

for (const [name, options, reason] of [
  ['locator', { locatorAcl: true, locatorReadFails: true }, 'locator-permissions'],
  ['locator directory', { locatorDirectoryAcl: true, locatorReadFails: true }, 'locator-directory-permissions'],
] as const) {
  test(`rejects an ACL on the ${name} before reading it`, async ($, on) => {
    const calls = installTarget(on, options)

    const result = await status($)

    expect(result.text).toContain('support: unsupported target')
    expect(result.text).toContain(`reason: ${reason}`)
    expect(result.text).toContain('helper: not checked')
    expect(result.text).not.toContain('PT-SECRET-MARKER')
    expect(calls.some(argv => argv[0] === helperPath)).toBe(false)
  })
}

test('reports a helper missing from a trusted locator', async ($, on) => {
  const calls = installTarget(on, {
    locator: locator({ artifactStatus: 'helper-missing' }),
  })

  const result = await status($)

  expect(result.text).toContain('support: helper unavailable')
  expect(result.text).toContain('reason: helper-missing')
  expect(result.text).toContain(`helper: unavailable · ${helperPath}`)
  expect(calls.some(argv => argv[0] === helperPath)).toBe(false)
})

test('reports a helper removed after locator publication', async ($, on) => {
  const calls = installTarget(on, { helperStatFails: true })

  const result = await status($)

  expect(result.text).toContain('support: helper unavailable')
  expect(result.text).toContain('reason: helper-missing')
  expect(result.text).toContain(`helper: unavailable · ${helperPath}`)
  expect(result.text).toContain(`database root: ${databaseRoot}`)
  expect(result.text).not.toContain('PT-SECRET-MARKER')
  expect(calls.some(argv => argv[0] === helperPath)).toBe(false)
})

test('reports a manifest removed after locator publication', async ($, on) => {
  const calls = installTarget(on, { manifestStatFails: true })

  const result = await status($)

  expect(result.text).toContain('support: helper unavailable')
  expect(result.text).toContain('reason: manifest-missing')
  expect(result.text).not.toContain('PT-SECRET-MARKER')
  expect(calls.some(argv => argv[0] === helperPath)).toBe(false)
})

test('rejects a locator bound to a different helper digest', async ($, on) => {
  const calls = installTarget(on, {
    locator: locator({ helperSha256: '0'.repeat(64) }),
  })

  const result = await status($)

  expect(result.text).toContain('support: helper unavailable')
  expect(result.text).toContain('reason: locator-digest-mismatch')
  expect(calls.some(argv => argv[0] === helperPath)).toBe(false)
})

test('rejects an incompatible helper protocol before execution', async ($, on) => {
  const calls = installTarget(on, {
    locator: locator({ helperProtocol: 99 }),
  })

  const result = await status($)

  expect(result.text).toContain('support: helper unavailable')
  expect(result.text).toContain('reason: protocol-mismatch')
  expect(result.text).toContain(`helper: unavailable · ${helperPath}`)
  expect(result.text).toContain(`database root: ${databaseRoot}`)
  expect(calls.some(argv => argv[0] === helperPath)).toBe(false)
})

test('refreshes helper status within the same session', async ($, on) => {
  const options = { actualDigest: EXPECTED_HELPER_SHA256 }
  installTarget(on, options)

  const first = await status($)
  expect(first.text).toContain('support: supported')

  options.actualDigest = '0'.repeat(64)
  const refreshed = await $.command.run({
    command: 'prompt-history',
    args: 'status',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 80 },
  })

  expect(refreshed.text).toContain('support: helper unavailable')
  expect(refreshed.text).toContain('reason: digest-mismatch')
  expect(refreshed.text).toContain(`helper: unavailable · ${helperPath}`)
})

test('rejects a helper whose file digest changed', async ($, on) => {
  const calls = installTarget(on, { actualDigest: '0'.repeat(64) })

  const result = await status($)

  expect(result.text).toContain('support: helper unavailable')
  expect(result.text).toContain('reason: digest-mismatch')
  expect(result.text).toContain(`helper: unavailable · ${helperPath}`)
  expect(result.text).toContain(`database root: ${databaseRoot}`)
  expect(calls.some(argv => argv[0] === helperPath)).toBe(false)
})

test('rejects a non-regular helper before execution', async ($, on) => {
  const calls = installTarget(on, { helperKind: 'Symbolic Link' })

  const result = await status($)

  expect(result.text).toContain('support: helper unavailable')
  expect(result.text).toContain('reason: helper-not-regular')
  expect(calls.some(argv => argv[0] === helperPath)).toBe(false)
  expect(calls.some(argv => argv.includes('create'))).toBe(false)
})

test('rejects a non-executable helper before execution', async ($, on) => {
  const calls = installTarget(on, { helperMode: '644' })

  const result = await status($)

  expect(result.text).toContain('support: helper unavailable')
  expect(result.text).toContain('reason: helper-not-executable')
  expect(calls.some(argv => argv[0] === helperPath)).toBe(false)
})

test('rejects a group-writable helper before execution', async ($, on) => {
  const calls = installTarget(on, { helperMode: '775' })

  const result = await status($)

  expect(result.text).toContain('support: helper unavailable')
  expect(result.text).toContain('reason: helper-untrusted')
  expect(calls.some(argv => argv[0] === helperPath)).toBe(false)
})

test('rejects a group-writable manifest before execution', async ($, on) => {
  const calls = installTarget(on, { manifestMode: '664' })

  const result = await status($)

  expect(result.text).toContain('support: helper unavailable')
  expect(result.text).toContain('reason: manifest-untrusted')
  expect(calls.some(argv => argv[0] === helperPath)).toBe(false)
})
