// PROTOTYPE (throwaway): another plugin's docked pane, opened unasked from a timer like diff's auto-open.
const PANE = 'other'
let renders = 0
let ev = []
let t0 = 0
const log = (...a) => ev.push([Date.now() - t0, ...a])

export const register = on => {
  on('session.start', async ($, e, next) => {
    t0 = Date.now()
    for (const [name, description] of [['oto', 'other open unasked (timer)'], ['otf', 'other open asked focus'], ['otn', 'other open asked'], ['otc', 'other close'], ['otd', 'other dump']]) {
      await $.command.register({ name, description, immediate: true })
    }
    if ((await $.env.get('OT_START')) === '1') {
      $.clock.after(1500, async () => log('open', 'start-timer', JSON.stringify(await $.ui.open({ id: PANE, title: 'Other', columns: 50 }))))
    }
    return next(e)
  })
  on('command.run', { command: 'oto' }, async ($) => {
    $.clock.after(800, async () => log('open', 'timer', JSON.stringify(await $.ui.open({ id: PANE, title: 'Other', columns: 50 }))))
    return { text: 'scheduled' }
  })
  on('command.run', { command: 'otf' }, async ($) => ({ text: JSON.stringify(await $.ui.open({ id: PANE, title: 'Other', columns: 50, focus: true })) }))
  on('command.run', { command: 'otn' }, async ($) => ({ text: JSON.stringify(await $.ui.open({ id: PANE, title: 'Other', columns: 50 })) }))
  on('command.run', { command: 'otc' }, async ($) => { await $.ui.close({ id: PANE }); return { text: 'closed' } })
  on('command.run', { command: 'otd' }, async ($) => {
    const name = `${$.plugin.root}/../logs/other-${t0}.json`
    await $.fs.write(name, JSON.stringify(ev))
    return { text: name }
  })
  on('ui.close', async ($, e, next) => {
    const r = await next(e)
    log('ui.close-seen', e.id, e.origin && e.origin.kind)
    return r
  })
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    renders++
    const { Box, Text } = $.ui.resolve(e)
    log('render', e.props.isFocused)
    return Box({ flexDirection: 'column', children: [Text({ children: [`OTHERPANE r=${renders} focused=${e.props.isFocused}`] })] })
  })
}
