import type { Register } from 'claude-code'

// Throwaway probe for chat-toc 0.2 ticket 05: what `$.session.usage()` returns
// and when it changes (`session.measure`), what `turn.complete` says of a turn's
// duration and tokens, and what a compaction looks like from a hook. Every
// entry goes to an in-memory log, written whole to PROBE_LOG after each one.

const log: string[] = []
let logPath: string | undefined
const started = Date.now()

function json(value: unknown): string {
  return JSON.stringify(value, (k, v) => (k === 'breakdown' || k === 'messages' || k === 'answer' ? `<${typeof v}>` : v))
}

async function note($: any, line: string) {
  log.push(`${new Date().toISOString()} +${((Date.now() - started) / 1000).toFixed(2)}s ${line}`)
  logPath ??= (await $.env.get('PROBE_LOG')) ?? `${$.plugin.root}/../usage-probe.log`
  await $.fs.write(logPath, log.join('\n') + '\n').catch(() => undefined)
}

async function snapshot($: any, why: string) {
  const u = await $.session.usage()
  await note($, `usage (${why}) ${json({ startedAt: u.startedAt, context: u.context, cost: u.cost, rateLimits: u.rateLimits })}`)
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'usageprobe', description: 'usage-probe: usage | full | turns', immediate: true })
    await note($, `session.start version=${json(await $.session.version())} reason=${json((e as any).reason)}`)
    await snapshot($, 'session.start')
    return next(e)
  })
  on('session.measure', async ($, e, next) => {
    await note($, `session.measure ${json(e)}`)
    return next(e)
  })
  on('turn.start', async ($, e, next) => {
    await note($, `turn.start ${json(e)}`)
    return next(e)
  })
  on('turn.complete', async ($, e, next) => {
    await note($, `turn.complete ${json({ ...e, answerLength: e.answer.length })}`)
    const out = await next(e)
    await snapshot($, 'after turn.complete')
    return out
  })
  on('session.compact', async ($, e, next) => {
    await note($, `session.compact in ${json({ trigger: e.trigger, agentId: e.agentId, instructions: e.instructions, messages: e.messages.length })}`)
    const out: any = await next(e)
    await note($, `session.compact out ${json({ skip: out?.skip, tokensBefore: out?.tokensBefore, tokensAfter: out?.tokensAfter, usage: out?.usage, messages: out?.messages?.length })}`)
    await snapshot($, 'after session.compact')
    $.clock.after(500, async () => snapshot($, '500 ms after session.compact'))
    return out
  })
  on('command.run', { command: 'usageprobe' }, async ($, e) => {
    const verb = String((e as any).args ?? '').trim() || 'usage'
    if (verb === 'full' || verb === 'summary') {
      const u = await $.session.usage({ breakdown: verb })
      const b: any = u.context.breakdown
      await note($, `usage (${verb}) ${json({ context: { ...u.context, breakdown: undefined }, measured: b && { totalTokens: b.totalTokens, rawMaxTokens: b.rawMaxTokens, percentage: b.percentage, autoCompactThreshold: b.autoCompactThreshold, isAutoCompactEnabled: b.isAutoCompactEnabled, apiUsage: b.apiUsage } })}`)
    } else if (verb === 'turns') {
      const m = await $.session.messages()
      await note($, `turns=${await $.session.turns()} messages=${m.length} roles=${json(m.map((x: any) => x.role).join(''))}`)
    } else {
      await snapshot($, 'command')
    }
    return {}
  })
}
