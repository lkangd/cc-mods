import type { EngineInterface, On, SessionMessage } from 'claude-code'

// THROWAWAY PROTOTYPE. Do not move this logger into the production plugin.
const moduleInstanceId = `${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 10)}`
const relativeTraceDirectory =
  '.scratch/prompt-history/prototypes/prompt-alignment-rewind/traces'

type PendingRecord = {
  at: string
  event: string
  phase: 'point' | 'before' | 'after'
  data?: Record<string, unknown>
}

const pending: PendingRecord[] = []
let probeRunId: string | undefined
let hostPid: string | undefined
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

async function ensureRunIdentity($: EngineInterface): Promise<string> {
  if (probeRunId) return probeRunId

  const pidResult = await $.process.run([
    'node',
    '-e',
    'process.stdout.write(String(process.ppid))',
  ])
  hostPid =
    pidResult.exitCode === 0 ? pidResult.stdout.trim() : `unknown-${moduleInstanceId}`

  const inheritedPid = await $.env.get('PROMPT_HISTORY_PROBE_HOST_PID')
  const inheritedRunId = await $.env.get('PROMPT_HISTORY_PROBE_RUN_ID')

  if (inheritedPid === hostPid && inheritedRunId) {
    probeRunId = inheritedRunId
  } else {
    probeRunId = `run-${hostPid}-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`
    await $.env.set('PROMPT_HISTORY_PROBE_HOST_PID', hostPid)
    await $.env.set('PROMPT_HISTORY_PROBE_RUN_ID', probeRunId)
  }

  return probeRunId
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
    const runId = await ensureRunIdentity($)

    if (!tracePath) {
      const root = cwd ?? (await $.session.cwd())
      tracePath = `${root}/${relativeTraceDirectory}/${runId}.jsonl`
    }

    if (!loaded) {
      try {
        traceText = await $.fs.read(tracePath)
      } catch {
        traceText = ''
      }

      sequence = traceText.split('\n').filter(Boolean).length
      loaded = true

      for (const buffered of pending.splice(0)) {
        traceText += `${JSON.stringify({
          sequence: ++sequence,
          probeRunId: runId,
          hostPid,
          moduleInstanceId,
          ...buffered,
        })}\n`
      }
    }

    traceText += `${JSON.stringify({
      sequence: ++sequence,
      probeRunId: runId,
      hostPid,
      moduleInstanceId,
      ...record,
    })}\n`
    await $.fs.write(tracePath, traceText)
  })

  return writeQueue
}

function summarizeMessages(messages: SessionMessage[]): Record<string, unknown>[] {
  return messages.map((message, index) => ({
    index,
    role: message.role,
    ...(message.role === 'user' ? { text: message.text } : {}),
    textLength: message.text.length,
    toolUseCount: message.toolUses.length,
    toolResultCount: message.toolResults?.length ?? 0,
  }))
}

async function transcriptSnapshot(
  $: EngineInterface,
): Promise<Record<string, unknown>> {
  const [sessionId, turns, messages] = await Promise.all([
    $.session.id(),
    $.session.turns(),
    $.session.messages(),
  ])

  return {
    sessionId,
    turns,
    messageCount: messages.length,
    messages: summarizeMessages(messages),
  }
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
    await append(
      $,
      'session.start',
      'before',
      {
        cwd: e.cwd,
        surface: e.surface,
        isInteractive: e.isInteractive,
        sessionId: await $.session.id(),
      },
      e.cwd,
    )

    await $.command.register({
      name: 'prompt-history-probe-mark',
      description: 'Write a named marker to the prompt alignment prototype trace',
      argumentHint: '<label>',
    })
    await $.command.register({
      name: 'prompt-history-probe-snapshot',
      description: 'Record the current transcript shape in the prototype trace',
      argumentHint: '<label>',
    })
    await $.command.register({
      name: 'prompt-history-probe-info',
      description: 'Show the prototype run, session and trace identities',
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
      sessionId: await $.session.id(),
    })
    const result = await next(e)
    await append($, 'command.run', 'after', {
      command: e.command,
      hasText: result.text !== undefined,
      ref: result.ref,
      sessionId: await $.session.id(),
    })
    return result
  })

  on('command.run', { command: 'prompt-history-probe-mark' }, async ($, e) => {
    const label = e.args.trim() || '(empty)'
    await append($, 'manual.marker', 'point', {
      label,
      sessionId: await $.session.id(),
    })
    return { text: `Probe marker written: ${label}` }
  })

  on(
    'command.run',
    { command: 'prompt-history-probe-snapshot' },
    async ($, e) => {
      const label = e.args.trim() || '(empty)'
      await append($, 'manual.snapshot', 'point', {
        label,
        ...(await transcriptSnapshot($)),
      })
      return { text: `Transcript snapshot written: ${label}` }
    },
  )

  on('command.run', { command: 'prompt-history-probe-info' }, async $ => {
    const runId = await ensureRunIdentity($)
    const sessionId = await $.session.id()
    await append($, 'probe.info', 'point', { runId, sessionId, tracePath })
    return {
      text: `probeRunId=${runId}\nsessionId=${sessionId}\ntrace=${
        tracePath ?? relativeTraceDirectory
      }`,
    }
  })

  on('prompt.submit', async ($, e, next) => {
    await append($, 'prompt.submit', 'before', {
      text: e.text,
      attachments: e.attachments?.length ?? 0,
      origin: e.origin,
      turnId: e.turnId,
      wait: e.wait,
      transcript: await transcriptSnapshot($),
    })
    const result = await next(e)
    await append($, 'prompt.submit', 'after', {
      text: result.text,
      origin: result.origin,
      drop: result.drop,
      transcript: await transcriptSnapshot($),
    })
    return result
  })

  on('prompt.fill', async ($, e, next) => {
    await append($, 'prompt.fill', 'before', {
      text: e.text,
      origin: e.origin,
      sessionId: await $.session.id(),
    })
    const result = await next(e)
    await append($, 'prompt.fill', 'after', {
      isFilled: result.isFilled,
      sessionId: await $.session.id(),
    })
    return result
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    await append(
      $,
      'classic.UserPromptSubmit',
      'before',
      {
        prompt: e.prompt,
        source: e.source,
        sessionId: e.session_id,
        promptId: e.prompt_id,
      },
      e.cwd,
    )
    const result = await next(e)
    await append(
      $,
      'classic.UserPromptSubmit',
      'after',
      {
        source: e.source,
        sessionId: e.session_id,
        promptId: e.prompt_id,
      },
      e.cwd,
    )
    return result
  })

  on('turn.start', async ($, e, next) => {
    await append($, 'turn.start', 'before', {
      text: e.text,
      turnId: e.turnId,
      transcript: await transcriptSnapshot($),
    })
    const result = await next(e)
    await append($, 'turn.start', 'after', { turnId: result.turnId })
    return result
  })

  on('turn.complete', async ($, e, next) => {
    await append($, 'turn.complete', 'before', {
      turnId: e.turnId,
      reason: e.reason,
      answerLength: e.answer.length,
      agentId: e.agentId,
    })
    const result = await next(e)
    await append($, 'turn.complete', 'after', {
      turnId: e.turnId,
      reason: e.reason,
      textLength: result.text.length,
      transcript: await transcriptSnapshot($),
    })
    return result
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    await append($, 'ui.render.UserMessage', 'point', {
      requestId: e.requestId,
      surface: e.surface,
      text: e.props.text,
      origin: e.props.origin,
      sessionId: await $.session.id(),
    })
    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    await append(
      $,
      'classic.SessionStart',
      'before',
      {
        source: e.source,
        sessionId: e.session_id,
        transcriptPath: e.transcript_path,
        promptId: e.prompt_id,
      },
      e.cwd,
    )
    const result = await next(e)
    await append(
      $,
      'classic.SessionStart',
      'after',
      { source: e.source, sessionId: e.session_id },
      e.cwd,
    )
    return result
  })

  on('classic.SessionEnd', async ($, e, next) => {
    await append(
      $,
      'classic.SessionEnd',
      'before',
      {
        reason: e.reason,
        sessionId: e.session_id,
        transcriptPath: e.transcript_path,
        promptId: e.prompt_id,
      },
      e.cwd,
    )
    const result = await next(e)
    await append(
      $,
      'classic.SessionEnd',
      'after',
      { reason: e.reason, sessionId: e.session_id },
      e.cwd,
    )
    return result
  })

  on('session.compact', async ($, e, next) => {
    await append($, 'session.compact', 'before', {
      trigger: e.trigger,
      messageCount: e.messages.length,
      agentId: e.agentId,
    })
    const result = await next(e)
    await append($, 'session.compact', 'after', {
      trigger: e.trigger,
      skipped: result.skip !== undefined,
      messageCount: result.messages?.length,
    })
    return result
  })
}
