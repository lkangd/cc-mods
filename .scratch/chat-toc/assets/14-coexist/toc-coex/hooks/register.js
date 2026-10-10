// PROTOTYPE (throwaway): stands in for chat-toc to measure dock-pane coexistence.
import { atom, read, update } from 'claude-code'

const PANE = 'toc'
const tickAtom = atom({ plugin: 'toc-coex', key: 'tick' }, 0)
const closedAtom = atom({ plugin: 'toc-coex', key: 'closed' }, false)
let ev = []
let renders = 0
let tick = 0
let lastShown = null
let t0 = 0

const log = (...a) => ev.push([Date.now() - t0, ...a])

async function open($, why, focus) {
  const r = await $.ui.open({ id: PANE, title: '对话目录', columns: 44, ...(focus ? { focus: true } : {}) })
  log('open', why, JSON.stringify(r))
  return r
}

export const register = on => {
  on('session.start', async ($, e, next) => {
    t0 = Date.now()
    log('session.start', e.source || '')
    for (const [name, description] of [['tco', 'toc open'], ['tcf', 'toc open focus'], ['tcp', 'toc panes'], ['tcd', 'toc dump'], ['tcx', 'toc close'], ['tcm', 'toc mark']]) {
      await $.command.register({ name, description, immediate: true })
    }
    $.clock.every(500, async () => {
      tick++
      update($, tickAtom, () => tick).catch(err => log('err-set', String(err)))
      try {
        const p = (await $.ui.panes()).find(x => x.id === PANE)
        const s = p ? `shown=${p.isShown} focused=${p.isFocused} placed=${p.isPlaced}` : 'none'
        if (s !== lastShown) { lastShown = s; log('panes', s) }
      } catch (err) { log('err-panes', String(err)) }
    })
    void (async () => {
      const closed = await read($, closedAtom)
      const up = (await $.ui.panes()).some(p => p.id === PANE)
      if (!closed && !up) await open($, 'auto', false)
      else log('skip-auto', closed, up)
    })()
    return next(e)
  })
  on('classic.SessionStart', async ($, e, next) => {
    log('classic.SessionStart', e.source)
    if (e.source === 'clear' || e.source === 'resume') {
      void (async () => {
        const closed = await read($, closedAtom)
        const up = (await $.ui.panes()).some(p => p.id === PANE)
        if (!closed && !up) await open($, 'auto-' + e.source, false)
        else log('skip-auto', e.source, closed, up)
      })()
    }
    return next(e)
  })
  on('ui.open', async ($, e, next) => {
    log('ui.open-seen', e.id, e.title || '')
    return next(e)
  })
  on('ui.close', async ($, e, next) => {
    const r = await next(e)
    log('ui.close-seen', e.id, e.origin && e.origin.kind, JSON.stringify(r || {}))
    if (e.id === PANE && e.origin && e.origin.kind === 'person' && !(r && r.deny)) {
      await update($, closedAtom, () => true)
    }
    return r
  })
  on('command.run', { command: 'tco' }, async ($) => ({ text: JSON.stringify(await open($, 'cmd', false)) }))
  on('command.run', { command: 'tcf' }, async ($) => ({ text: JSON.stringify(await open($, 'cmd-focus', true)) }))
  on('command.run', { command: 'tcx' }, async ($) => { await $.ui.close({ id: PANE }); return { text: 'closed' } })
  on('command.run', { command: 'tcm' }, async ($, e) => { log('MARK', e.args || ''); return { text: 'mark ' + (e.args || '') } })
  on('command.run', { command: 'tcp' }, async ($) => ({ text: JSON.stringify(await $.ui.panes()) + ' closed=' + (await read($, closedAtom)) }))
  on('command.run', { command: 'tcd' }, async ($) => {
    const name = `${$.plugin.root}/../logs/toc-${t0}.json`
    await $.fs.write(name, JSON.stringify(ev, null, 0))
    return { text: name + ' n=' + ev.length }
  })
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    renders++
    const { Box, Text } = $.ui.resolve(e)
    const t = await read($, tickAtom)
    log('render', t, e.props.isFocused, e.props.placement)
    return Box({
      flexDirection: 'column',
      children: [
        Text({ children: [`TOCPANE r=${renders} tick=${t}`] }),
        Text({ children: [`focused=${e.props.isFocused} ${e.props.placement}`] }),
      ],
    })
  })
}
