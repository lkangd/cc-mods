import type { Register, RenderElement } from 'claude-code'

// Throwaway probe for chat-toc 0.2 ticket 03: whether a Button's `action`
// presses it from the prompt, and when. Every press and render count goes to
// an in-memory log, written whole to PROBE_LOG after each entry.
//
// Panes: `action-probe` (the main one), `action-probe-2` (a second pane, to
// make the first a back tab and to clash on one action), `action-probe-bad`
// and `action-probe-reserved` (refused trees). The band above the prompt
// carries its own action Buttons and a digit hotkey.

const log: string[] = []
let logPath: string | undefined
const started = Date.now()
const renders: Record<string, number> = {}
let working = false

function stamp(): string {
  return `${((Date.now() - started) / 1000).toFixed(1)}s`
}

async function note($: any, line: string) {
  log.push(`${stamp()} ${line}`)
  logPath ??= (await $.env.get('PROBE_LOG')) ?? `${$.plugin.root}/../action-probe.log`
  await $.fs.write(logPath, log.join('\n') + '\n').catch(() => undefined)
}

// Each main-pane Button names an action; the world's keybindings.json binds it.
const PANE_ACTIONS: [key: string, action: string][] = [
  ['noise', 'app:toggleDiffNoiseFilter'], // ctrl+x p (Global), and the band's too
  ['presession', 'app:toggleDiffPreSession'], // meta+j (Global, a modified key)
  ['repl', 'app:toggleReplTab'], // ctrl+x g (Global)
  ['panenext', 'pane:next'], // ctrl+x . (Global; the engine's own when two panes are open)
  ['redraw', 'app:redraw'], // ctrl+x r (Global; the engine handles it)
  ['todos', 'app:toggleTodos'], // ctrl+t by default (Global; the engine handles it)
  ['footer', 'footer:dismiss'], // ctrl+x d (bound in Global, a Footer action)
  ['diffback', 'diff:back'], // ctrl+x q (bound in Global, a DiffDialog action)
  ['prevfield', 'confirm:previousField'], // f6 (Global, a bare key)
]

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'actionprobe', description: 'action-probe: open | open2 | close | close2 | bad | reserved | focus | log', immediate: true })
    await note($, `session.start version=${await $.session.version()}`)
    return next(e)
  })

  on('turn.start', async ($, e, next) => { working = true; await note($, 'turn.start'); return next(e) })
  on('turn.complete', async ($, e, next) => { working = false; await note($, 'turn.complete'); return next(e) })

  // The press as the chain carries it: does anything say where it came from?
  on('ui.press', async ($, e, next) => {
    if (e.plugin === 'action-probe') {
      await note($, `ui.press hook: ${JSON.stringify(e)} keys=${Object.keys(e).join(',')}`)
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    renders.band = (renders.band ?? 0) + 1
    if ((await $.env.get('PROBE_BAND')) === '0') return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const press = (key: string) => (p: any) => note($, `PRESS ${key} in band (surface=${p.surface}, working=${working}, renders=${JSON.stringify(renders)})`)
    return h(Box, { flexDirection: 'row', gap: 2 },
      h(Text, { dimColor: true }, 'band:'),
      h(Button, { key: 'band-noise', action: 'app:toggleDiffNoiseFilter', plain: true, onPress: press('band-noise') }, 'band noise'),
      h(Button, { key: 'band-debug', action: 'permission:toggleDebug', plain: true, onPress: press('band-debug') }, 'band debug'),
      h(Button, { key: 'band-seven', hotkey: '7', plain: true, onPress: press('band-seven') }, 'band seven')) as RenderElement
  })

  on('ui.render', { component: 'Pane', requestId: 'action-probe' }, async ($, e, next) => {
    renders.pane = (renders.pane ?? 0) + 1
    const { Box, Text, Button } = $.ui.resolve(e)
    const press = (key: string) => (p: any) => note($, `PRESS ${key} in pane (surface=${p.surface}, working=${working}, renders=${JSON.stringify(renders)})`)
    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true }, `action-probe on ${e.surface}`),
      ...PANE_ACTIONS.map(([key, action]) =>
        h(Button, { key, action, plain: true, onPress: press(key) }, `${key} ${action}`)),
      h(Button, { key: 'pane-seven', hotkey: '8', plain: true, onPress: press('pane-eight') }, 'pane eight'),
      h(Text, { dimColor: true }, '--- log ---'),
      ...log.slice(-5).map((line, i) => h(Text, { key: `log${i}`, wrap: 'truncate-end' }, line))) as RenderElement
  })

  on('ui.render', { component: 'Pane', requestId: 'action-probe-2' }, async ($, e, next) => {
    renders.pane2 = (renders.pane2 ?? 0) + 1
    const { Box, Text, Button } = $.ui.resolve(e)
    const press = (key: string) => (p: any) => note($, `PRESS ${key} in pane2 (surface=${p.surface}, working=${working}, renders=${JSON.stringify(renders)})`)
    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true }, 'action-probe-2'),
      h(Button, { key: 'noise2', action: 'app:toggleDiffNoiseFilter', plain: true, onPress: press('noise2') }, 'noise2 app:toggleDiffNoiseFilter')) as RenderElement
  })

  on('ui.render', { component: 'Pane', requestId: 'action-probe-bad' }, async ($, e, next) => {
    const { Box, Button } = $.ui.resolve(e)
    return h(Box, {}, h(Button, { key: 'bad', action: 'chattoc:previousTurn', onPress: () => undefined }, 'bad')) as RenderElement
  })

  on('ui.render', { component: 'Pane', requestId: 'action-probe-reserved' }, async ($, e, next) => {
    const { Box, Button } = $.ui.resolve(e)
    return h(Box, {}, h(Button, { key: 'reserved', action: 'app:interrupt', onPress: () => undefined }, 'reserved')) as RenderElement
  })

  on('command.run', { command: 'actionprobe' }, async ($, e) => {
    const verb = e.args.trim()
    if (verb === 'log') return { text: `${log.join('\n') || '(empty)'}\nrenders=${JSON.stringify(renders)}` }
    if (verb === 'close') { await $.ui.close({ id: 'action-probe' }); await note($, 'closed'); return {} }
    if (verb === 'close2') { await $.ui.close({ id: 'action-probe-2' }); await note($, 'closed2'); return {} }
    if (verb === 'focus') { await note($, `focus ${JSON.stringify(await $.ui.focus({ requestId: 'action-probe', key: 'noise' }))}`); return {} }
    const panes: Record<string, string> = { '': 'action-probe', open: 'action-probe', open2: 'action-probe-2', bad: 'action-probe-bad', reserved: 'action-probe-reserved' }
    const id = panes[verb]
    if (!id) return { text: `unknown: ${verb}` }
    const r = await $.ui.open({ id, title: id, columns: 52 })
    await note($, `open ${id} ${JSON.stringify(r)}`)
    return {}
  })
}
