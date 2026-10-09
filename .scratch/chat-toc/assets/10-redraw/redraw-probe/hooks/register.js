import { atom, read, update } from 'claude-code'

// Current position = smallest turn index among on-screen transcript rows (probe texts start with T###).
const cpAtom = atom({ plugin: 'redraw-probe', key: 'cp' }, -1)
const PANE = 'rp'
let mode = 'off'
let tag = ''
const rows = new Map()
const userIds = new Map()
let cp = -1
let pushed = -1
let ev = []
let cnt = {}
let stamp = 0

function bump(k) { cnt[k] = (cnt[k] || 0) + 1 }
function computeCp() {
  let m = Infinity
  for (const r of rows.values()) if (r.os) m = Math.min(m, r.turn)
  return m === Infinity ? -1 : m
}
function fail(where, err) { bump('err:' + where); ev.push([Date.now(), 'err', where, String(err && err.message || err).slice(0, 200)]) }

function onChange($) {
  if (mode === 'sync') {
    bump('inv')
    try { $.ui.invalidate('ui.render') } catch (err) { fail('sync', err) }
  } else if (mode === 'micro') {
    Promise.resolve().then(() => { bump('inv'); $.ui.invalidate('ui.render') }).catch(err => fail('micro', err))
  } else if (mode === 'after-inv') {
    $.clock.after(0, () => { bump('inv'); try { $.ui.invalidate('ui.render') } catch (err) { fail('after-inv', err) } })
  } else if (mode === 'micro-state') {
    Promise.resolve().then(() => { bump('set'); return update($, cpAtom, () => cp) }).catch(err => fail('micro-state', err))
  } else if (mode === 'after-state') {
    $.clock.after(0, () => { bump('set'); update($, cpAtom, () => cp).catch(err => fail('after-state', err)) })
  }
}

async function dump($) {
  const name = `${$.plugin.root}/../logs/${tag}-${mode}-${stamp}.json`
  await $.fs.write(name, JSON.stringify({ tag, mode, cnt, ev }))
  const n = ev.length
  ev = []
  cnt = {}
  return name + ' events=' + n
}

export const register = on => {
  on('session.start', async ($, e, next) => {
    mode = (await $.env.get('RP_MODE')) || 'off'
    tag = (await $.env.get('RP_TAG')) || 'x'
    stamp = await $.clock.now()
    await $.command.register({ name: 'rpd', description: 'Dump redraw-probe counters', immediate: true })
    await $.command.register({ name: 'rp', description: 'Open redraw-probe pane', immediate: true })
    const r = await $.ui.open({ id: PANE, title: 'RP ' + mode, columns: 44 })
    ev.push([Date.now(), 'open', JSON.stringify(r)])
    if (mode === 'poll-state' || mode === 'poll-inv') {
      $.clock.every(50, () => {
        bump('tick')
        if (cp === pushed) return
        pushed = cp
        if (mode === 'poll-state') { bump('set'); update($, cpAtom, () => cp).catch(err => fail('poll-state', err)) }
        else { bump('inv'); try { $.ui.invalidate('ui.render') } catch (err) { fail('poll-inv', err) } }
      })
    }
    return next(e)
  })
  for (const c of ['UserMessage', 'AssistantMessage']) {
    on('ui.render', { component: c }, async ($, e, next) => {
      bump('t:' + c)
      const p = e.props
      const m = /^T(\d{3})/.exec(p.text || '')
      if (m && e.requestId !== 'placeholder') {
        const turn = Number(m[1])
        if (c === 'UserMessage') userIds.set(turn, e.requestId)
        rows.set(e.requestId, { turn, os: p.onScreen || null })
        const n = computeCp()
        if (n !== cp) {
          cp = n
          ev.push([Date.now(), 'cp', n])
          onChange($)
        }
      }
      if (mode === 'loop') {
        bump('inv')
        try { $.ui.invalidate('ui.render') } catch (err) { fail('loop', err) }
      }
      return next(e)
    })
  }
  on('command.run', { command: 'rpd' }, async ($) => ({ text: await dump($) }))
  on('command.run', { command: 'rp' }, async ($) => ({ text: JSON.stringify(await $.ui.open({ id: PANE, title: 'RP ' + mode, columns: 44 })) }))
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    bump('pane')
    const { Box, Text, Button } = $.ui.resolve(e)
    const viaState = mode.endsWith('state')
    const shown = viaState ? await read($, cpAtom) : cp
    ev.push([Date.now(), 'pane', shown])
    const items = []
    for (let i = 0; i < 300; i++) {
      const id = userIds.get(i)
      items.push(Button({
        key: 'b' + i,
        label: (i === shown ? '▶ ' : '  ') + 'T' + String(i).padStart(3, '0') + ' 你 · 用户问题：请检查第 ' + i + ' 个模块',
        onPress: () => { if (id) $.ui.scroll({ to: { requestId: id }, block: 'start' }) },
      }))
    }
    return Box({
      flexDirection: 'column',
      children: [Text({ children: ['cp=T' + shown + ' pane=' + (cnt.pane || 0) + ' inv=' + (cnt.inv || 0) + ' set=' + (cnt.set || 0)] }), ...items],
    })
  })
}
