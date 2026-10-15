import type { Register } from 'claude-code'

// Model-free probe: writes what the host publishes at session start and what
// $.session.* and $.ui.scroll say, as JSON files under $PROBE_OUT. Run it only
// in a logged-out world over synthetic transcripts.
let seq = 0

export const register: Register = (on) => {
  on('classic.SessionStart', async ($, e, next) => {
    const out = await $.env.get('PROBE_OUT')
    if (out) {
      seq += 1
      await $.fs.write(`${out}/classic-start-${seq}.json`, JSON.stringify({ event: e, sessionId: await $.session.id() }, null, 1))
    }
    return next(e)
  })
  on('session.start', async ($, e, next) => {
    const out = await $.env.get('PROBE_OUT')
    if (out) {
      seq += 1
      await $.fs.write(`${out}/session-start-${seq}.json`, JSON.stringify({ event: e, sessionId: await $.session.id() }, null, 1))
    }
    await $.command.register({ name: 'forkprobe', description: 'fork probe' })
    return next(e)
  })
  on('command.run', { command: 'forkprobe' }, async ($) => {
    const out = await $.env.get('PROBE_OUT')
    const pre = await $.env.get('PROBE_PRE')
    const post = await $.env.get('PROBE_POST')
    const messages = await $.session.messages()
    const info: Record<string, unknown> = {
      id: await $.session.id(),
      version: await $.session.version(),
      turns: await $.session.turns(),
      messageCount: messages.length,
      messageKeys: messages.slice(0, 3).map((m) => Object.keys(m)),
      firstRoles: messages.slice(0, 6).map((m) => m.role),
    }
    if (pre) info.scrollPre = await $.ui.scroll({ to: { requestId: pre } })
    if (post) info.scrollPost = await $.ui.scroll({ to: { requestId: post } })
    if (out) {
      seq += 1
      await $.fs.write(`${out}/probe-${seq}.json`, JSON.stringify(info, null, 1))
    }
    return { text: `forkprobe done out=${out ?? 'unset'} wrote=${seq}` }
  })
}
