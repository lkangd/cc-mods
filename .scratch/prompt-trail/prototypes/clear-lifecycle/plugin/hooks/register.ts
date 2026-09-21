import type { EngineInterface, On } from 'claude-code'

// THROWAWAY PROTOTYPE. Do not move this logger into the production plugin.
const moduleInstanceId = `${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 10)}`
const relativeTracePath =
  '.scratch/prompt-trail/prototypes/clear-lifecycle/trace.jsonl'

type PendingRecord = {
  at: string
  event: string
  phase: 'point' | 'before' | 'after'
  data?: Record<string, unknown>
}

const pending: PendingRecord[] = []
let tracePath: string | undefined
let traceText = ''
let sequence = 0
let loaded = false
let writeQueue = Promise.resolve()

function pendingRecord(
  event: string,
  phase: PendingRecord['phase'] = 'point',
  data?: Record<string, unknown>,
): PendingRecord {
  return { at: new Date().toISOString(), event, phase, data }
}

function buffer(
  event: string,
  phase: PendingRecord['phase'] = 'point',
  data?: Record<string, unknown>,
): void {
  pending.push(pendingRecord(event, phase, data))
}

async function append(
  $: EngineInterface,
  event: string,
  phase: PendingRecord['phase'] = 'point',
  data?: Record<string, unknown>,
  cwd?: string,
): Promise<void> {
  const record = pendingRecord(event, phase, data)

  writeQueue = writeQueue.then(async () => {
    if (!tracePath) {
      const root = cwd ?? (await $.session.cwd())
      tracePath = `${root}/${relativeTracePath}`
    }

    if (!loaded) {
      try {
        traceText = await $.fs.read(tracePath)
      } catch {
        traceText = ''
      }

      const lines = traceText.split('\n').filter(Boolean)
      sequence = lines.length
      loaded = true

      for (const buffered of pending.splice(0)) {
        traceText += `${JSON.stringify({
          sequence: ++sequence,
          moduleInstanceId,
          ...buffered,
        })}\n`
      }
    }

    traceText += `${JSON.stringify({
      sequence: ++sequence,
      moduleInstanceId,
      ...record,
    })}\n`
    await $.fs.write(tracePath, traceText)
  })

  return writeQueue
}

buffer('module.loaded', 'point', { moduleInstanceId })

export function register(on: On): void {
  buffer('register.called')

  on('engine.create', async (_$, e, next) => {
    buffer('engine.create', 'before', { plugins: [...e.plugins] })
    const result = await next(e)
    buffer('engine.create', 'after')
    return result
  })

  on('session.start', async ($, e, next) => {
    await append($, 'session.start', 'before', {
      cwd: e.cwd,
      surface: e.surface,
      isInteractive: e.isInteractive,
      sessionId: await $.session.id(),
    }, e.cwd)

    await $.command.register({
      name: 'clear-lifecycle-mark',
      description: 'Write a named marker to the clear lifecycle prototype trace',
      argumentHint: '<label>',
    })
    await $.command.register({
      name: 'clear-lifecycle-path',
      description: 'Show the clear lifecycle prototype trace path',
    })

    const result = await next(e)
    await append($, 'session.start', 'after', { cwd: result.cwd }, e.cwd)
    return result
  })

  on('command.run', async ($, e, next) => {
    await append($, 'command.run', 'before', {
      command: e.command,
      args: e.args,
      origin: e.origin.kind,
      isFullscreen: e.presentation.isFullscreen,
      columns: e.presentation.columns,
    })

    const result = await next(e)
    await append($, 'command.run', 'after', {
      command: e.command,
      hasText: result.text !== undefined,
      ref: result.ref,
    })
    return result
  })

  on('command.run', { command: 'clear-lifecycle-mark' }, async ($, e) => {
    const label = e.args.trim() || '(empty)'
    await append($, 'manual.marker', 'point', { label })
    return { text: `Lifecycle marker written: ${label}` }
  })

  on('command.run', { command: 'clear-lifecycle-path' }, async ($) => {
    await append($, 'trace.path.requested')
    return { text: tracePath ?? relativeTracePath }
  })

  on('classic.SessionEnd', async ($, e, next) => {
    await append($, 'classic.SessionEnd', 'before', {
      sessionId: e.session_id,
      transcriptPath: e.transcript_path,
      cwd: e.cwd,
      promptId: e.prompt_id,
      reason: e.reason,
    }, e.cwd)
    const result = await next(e)
    await append($, 'classic.SessionEnd', 'after', { reason: e.reason }, e.cwd)
    return result
  })

  on('classic.SessionStart', async ($, e, next) => {
    await append($, 'classic.SessionStart', 'before', {
      sessionId: e.session_id,
      transcriptPath: e.transcript_path,
      cwd: e.cwd,
      promptId: e.prompt_id,
      source: e.source,
    }, e.cwd)
    const result = await next(e)
    await append($, 'classic.SessionStart', 'after', { source: e.source }, e.cwd)
    return result
  })

  on('classic.PreCompact', async ($, e, next) => {
    await append($, 'classic.PreCompact', 'before', {
      sessionId: e.session_id,
      trigger: e.trigger,
    }, e.cwd)
    const result = await next(e)
    await append($, 'classic.PreCompact', 'after', { trigger: e.trigger }, e.cwd)
    return result
  })

  on('classic.PostCompact', async ($, e, next) => {
    await append($, 'classic.PostCompact', 'before', {
      sessionId: e.session_id,
      trigger: e.trigger,
    }, e.cwd)
    const result = await next(e)
    await append($, 'classic.PostCompact', 'after', { trigger: e.trigger }, e.cwd)
    return result
  })

  on('session.compact', async ($, e, next) => {
    await append($, 'session.compact', 'before', {
      trigger: e.trigger,
      instructionLength: e.instructions?.length ?? 0,
      messageCount: e.messages.length,
    })
    const result = await next(e)
    await append($, 'session.compact', 'after', {
      trigger: e.trigger,
      skipped: result.skip !== undefined,
      messageCount: result.messages?.length,
    })
    return result
  })

  on('prompt.context', async ($, e, next) => {
    await append($, 'prompt.context', 'before', {
      blockNames: e.blocks.map(block => block.name),
    })
    const result = await next(e)
    await append($, 'prompt.context', 'after', {
      blockNames: result.blocks.map(block => block.name),
    })
    return result
  })

  on('ui.render', async ($, e, next) => {
    await append($, 'ui.render', 'point', {
      component: e.component,
      surface: e.surface,
      requestId: e.requestId,
      viewport: e.viewport,
    })
    return next(e)
  })
}
