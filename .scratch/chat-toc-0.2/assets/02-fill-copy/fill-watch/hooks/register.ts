import type { Register } from 'claude-code'

// Throwaway probe for chat-toc 0.2 ticket 02: what ANOTHER mod's hooks on
// prompt.fill and ui.copy see. WATCH_REFUSE=1 keeps every fill out without
// `next`; WATCH_REWRITE=1 upper-cases the text going down.

const log: string[] = []
let logPath: string | undefined
const started = Date.now()

async function note($: any, line: string) {
  log.push(`${((Date.now() - started) / 1000).toFixed(1)}s ${line}`)
  logPath ??= (await $.env.get('WATCH_LOG')) ?? `${$.plugin.root}/../fill-watch.log`
  await $.fs.write(logPath, log.join('\n') + '\n').catch(() => undefined)
}

export const register: Register = (on) => {
  on('prompt.fill', async ($, e, next) => {
    const seen = { text: e.text, mode: e.mode, origin: e.origin, decorations: e.decorations }
    if ((await $.env.get('WATCH_REFUSE')) === '1') {
      await note($, `prompt.fill saw ${JSON.stringify(seen)} -> refused`)
      return { isFilled: false }
    }
    const down = (await $.env.get('WATCH_REWRITE')) === '1' ? { ...e, text: e.text.toUpperCase() } : e
    const r = await next(down)
    await note($, `prompt.fill saw ${JSON.stringify(seen)} -> ${JSON.stringify(r)}`)
    return r
  })

  on('ui.copy', async ($, e, next) => {
    const r = await next(e)
    await note($, `ui.copy saw ${JSON.stringify({ chars: e.text.length, head: e.text.slice(0, 30), surface: e.surface })} -> ${JSON.stringify(r)}`)
    return r
  })
}
