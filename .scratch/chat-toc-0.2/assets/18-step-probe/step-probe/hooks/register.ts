import type { Register, RenderElement } from 'claude-code'

// Throwaway probe for chat-toc 0.2 ticket 18:
// 1. whether `$.ui.scroll` moves a transcript row from a Button press that
//    came by a bound key (`meta+j` -> app:toggleDiffPreSession, `meta+k` ->
//    app:toggleDiffNoiseFilter), from the pane and from the band;
// 2. whether the host redraws the band when the pane becomes, or stops
//    being, a back tab (the band draws only while `$.ui.panes()` says the
//    pane is not shown).
// Every press, scroll result and band drawing goes to PROBE_LOG.

const log: string[] = []
let logPath: string | undefined
const started = Date.now()
let bandRenders = 0
let paneRenders = 0
let presses = 0
let targets: { prev: string; next: string } = { prev: '', next: '' }

function stamp(): string {
  return `${((Date.now() - started) / 1000).toFixed(1)}s`
}

async function note($: any, line: string) {
  log.push(`${stamp()} ${line}`)
  logPath ??= (await $.env.get('PROBE_LOG')) ?? `${$.plugin.root}/../step-probe.log`
  await $.fs.write(logPath, log.join('\n') + '\n').catch(() => undefined)
}

// The press's whole work: the scroll goes first, then the log.
async function step($: any, where: string, dir: 'prev' | 'next') {
  const n = ++presses
  const requestId = targets[dir]
  const got = await $.ui.scroll({ to: { requestId }, block: 'start' }).catch((error: unknown) => ({ deny: `threw ${String(error)}` }))
  await note($, `PRESS#${n} ${dir} in ${where} -> scroll ${requestId.slice(0, 8)} ${JSON.stringify(got)}`)
}

async function paneShown($: any): Promise<boolean | undefined> {
  const pane = (await $.ui.panes()).find((p: any) => p.id === 'step-probe')
  return pane?.isShown
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'stepprobe', description: 'step-probe: open | open2 | close | close2 | log', immediate: true })
    targets = { prev: (await $.env.get('PROBE_PREV')) ?? '', next: (await $.env.get('PROBE_NEXT')) ?? '' }
    await note($, `session.start version=${await $.session.version()} targets=${JSON.stringify(targets)}`)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    bandRenders++
    const shown = await paneShown($)
    await note($, `band render #${bandRenders} paneShown=${shown}`)
    if (shown === true) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    return h(Box, { flexDirection: 'row', gap: 1 },
      h(Text, { dimColor: true }, `PROBEBAND r${bandRenders}`),
      h(Button, { key: 'band-prev', action: 'app:toggleDiffNoiseFilter', plain: true, onPress: () => step($, 'band', 'prev') }, '‹'),
      h(Button, { key: 'band-next', action: 'app:toggleDiffPreSession', plain: true, onPress: () => step($, 'band', 'next') }, '›')) as RenderElement
  })

  on('ui.render', { component: 'Pane', requestId: 'step-probe' }, async ($, e) => {
    paneRenders++
    const { Box, Text, Button } = $.ui.resolve(e)
    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true }, `PROBEPANE r${paneRenders}`),
      h(Box, { flexDirection: 'row', gap: 1 },
        h(Button, { key: 'pane-prev', action: 'app:toggleDiffNoiseFilter', plain: true, onPress: () => step($, 'pane', 'prev') }, '‹'),
        h(Button, { key: 'pane-next', action: 'app:toggleDiffPreSession', plain: true, onPress: () => step($, 'pane', 'next') }, '›')),
      ...log.slice(-4).map((line, i) => h(Text, { key: `log${i}`, wrap: 'truncate-end' }, line))) as RenderElement
  })

  on('ui.render', { component: 'Pane', requestId: 'step-probe-2' }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return h(Box, {}, h(Text, {}, 'PROBEPANE2 in front')) as RenderElement
  })

  on('command.run', { command: 'stepprobe' }, async ($, e) => {
    const verb = e.args.trim()
    if (verb === 'log') return { text: log.join('\n') || '(empty)' }
    if (verb === 'close') { await $.ui.close({ id: 'step-probe' }); await note($, 'closed'); return {} }
    if (verb === 'close2') { await $.ui.close({ id: 'step-probe-2' }); await note($, 'closed2'); return {} }
    const id = verb === 'open2' ? 'step-probe-2' : 'step-probe'
    const r = await $.ui.open({ id, title: id, columns: 44 })
    await note($, `open ${id} ${JSON.stringify(r)}`)
    return {}
  })
}
