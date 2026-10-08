import type { EngineInterface, On } from 'claude-code'

// THROWAWAY PROTOTYPE. Do not move this bridge or protocol into production.
const moduleInstanceId = `${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 10)}`
const locatorSuffix =
  '.claude/plugins/data/.function-hook-locators/prompt-history-sqlite-probe.json'

type Locator = {
  version: 1
  helper: string
  database: string
}

type ProbeState = {
  locatorPath?: string
  locator?: Locator
  projectRoot?: string
  runId?: string
  lastError?: string
}

const state: ProbeState = {}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function parseLocator(text: string): Locator {
  const value = JSON.parse(text) as Partial<Locator>
  if (
    value.version !== 1 ||
    typeof value.helper !== 'string' ||
    !value.helper.startsWith('/') ||
    typeof value.database !== 'string' ||
    !value.database.startsWith('/')
  ) {
    throw new Error('command-hook bridge locator is invalid')
  }
  return value as Locator
}

async function helper(
  $: EngineInterface,
  args: readonly string[],
  stdin = '',
): Promise<string> {
  if (!state.locator) throw new Error('command-hook bridge is unavailable')
  const result = await $.process.run(
    [state.locator.helper, ...args],
    { stdin, timeoutMs: 10_000 },
  )
  if (result.exitCode !== 0) {
    throw new Error(
      result.stderr.trim() || `SQLite helper exited ${result.exitCode}`,
    )
  }
  return result.stdout.trim()
}

async function resolveProjectRoot(
  $: EngineInterface,
  cwd: string,
): Promise<string> {
  const result = await $.process.run(
    ['git', 'rev-parse', '--show-toplevel'],
    { cwd, timeoutMs: 5_000 },
  )
  return result.exitCode === 0 && result.stdout.trim()
    ? result.stdout.trim()
    : cwd
}

async function ensureRunId($: EngineInterface): Promise<string> {
  const inherited = await $.env.get('PROMPT_HISTORY_SQLITE_PROBE_RUN_ID')
  if (inherited) return inherited
  const created = `run-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`
  await $.env.set('PROMPT_HISTORY_SQLITE_PROBE_RUN_ID', created)
  return created
}

async function append(
  $: EngineInterface,
  eventId: string,
  kind: string,
  text: string,
): Promise<string> {
  if (!state.locator || !state.projectRoot || !state.runId) {
    throw new Error('SQLite probe did not initialize')
  }
  return helper(
    $,
    [
      'append',
      state.locator.database,
      state.projectRoot,
      eventId,
      state.runId,
      'segment-probe',
      'branch-probe',
      '-',
      kind,
      new Date().toISOString(),
      '--stdin',
    ],
    text,
  )
}

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await Promise.all([
      $.command.register({
        name: 'prompt-history-sqlite-info',
        description: 'Show the throwaway SQLite helper bridge and archive state',
      }),
      $.command.register({
        name: 'prompt-history-sqlite-write',
        description: 'Append synthetic text through the throwaway SQLite helper',
        argumentHint: '<synthetic-text>',
      }),
      $.command.register({
        name: 'prompt-history-sqlite-read',
        description: 'Read an incremental range from the throwaway SQLite helper',
        argumentHint: '[after-sequence] [limit]',
      }),
    ])

    try {
      const home = await $.env.get('HOME')
      if (!home) throw new Error('HOME is unset')
      state.locatorPath = `${home}/${locatorSuffix}`
      state.locator = parseLocator(await $.fs.read(state.locatorPath))
      state.projectRoot = await resolveProjectRoot($, e.cwd)
      state.runId = await ensureRunId($)
      await helper($, ['inspect', state.locator.database, state.projectRoot])
      await append(
        $,
        `boot-${state.runId}-${moduleInstanceId}`,
        'run-start',
        '',
      )
      state.lastError = undefined
    } catch (error) {
      state.lastError = errorText(error)
      $.ui.status(`prompt-history SQLite probe: ${state.lastError}`)
    }

    return next(e)
  })

  on('command.run', { command: 'prompt-history-sqlite-info' }, async ($) => {
    let archive: unknown
    try {
      archive = state.locator && state.projectRoot
        ? JSON.parse(
            await helper($, [
              'inspect',
              state.locator.database,
              state.projectRoot,
            ]),
          )
        : undefined
    } catch (error) {
      state.lastError = errorText(error)
    }
    return {
      text: JSON.stringify(
        {
          moduleInstanceId,
          locatorPath: state.locatorPath,
          locator: state.locator,
          projectRoot: state.projectRoot,
          runId: state.runId,
          archive,
          lastError: state.lastError,
        },
        null,
        2,
      ),
    }
  })

  on('command.run', { command: 'prompt-history-sqlite-write' }, async ($, e) => {
    const text = e.args.trim()
    if (!text) return { text: '用法：/prompt-history-sqlite-write <合成文本>' }
    try {
      const output = await append(
        $,
        `manual-${state.runId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        'prompt',
        text,
      )
      return { text: output }
    } catch (error) {
      state.lastError = errorText(error)
      return { text: `写入失败：${state.lastError}` }
    }
  })

  on('command.run', { command: 'prompt-history-sqlite-read' }, async ($, e) => {
    const [afterText = '0', limitText = '20'] = e.args.trim().split(/\s+/)
    const after = Number.parseInt(afterText, 10)
    const limit = Number.parseInt(limitText, 10)
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit)) {
      return { text: '用法：/prompt-history-sqlite-read [非负 sequence] [limit]' }
    }
    try {
      if (!state.locator || !state.projectRoot) throw new Error('SQLite probe did not initialize')
      const output = await helper($, [
        'range',
        state.locator.database,
        state.projectRoot,
        String(after),
        String(limit),
      ])
      return { text: output || '(empty)' }
    } catch (error) {
      state.lastError = errorText(error)
      return { text: `读取失败：${state.lastError}` }
    }
  })
}
