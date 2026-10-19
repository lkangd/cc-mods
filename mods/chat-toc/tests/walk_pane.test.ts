import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { PANE, drawnButtons, host, mountPane, start } from './host'
import { transcript } from './fixture'

/* CT-STEP-001's automated half: the ‹ › Buttons at the search row's right
   end and in the band, the borrowed actions they carry, and the focus ring
   stepping over them (0.2 spec §1, §6). The scroll a press makes never reaches
   the test kit: the walk is tested in walk.test.ts and the jump in a PTY. */

function session() {
  const t = transcript()
  t.prompt('CT-SYN fix the login page')
  t.reply([{ type: 'text', text: 'CT-SYN the login form validates' }])
  t.prompt('CT-SYN write the readme')
  t.reply([{ type: 'text', text: 'CT-SYN done' }])
  return t
}

const type = ($: Engine, text: string) => $.ui.input({ plugin: 'chat-toc', key: 'search', text, kind: 'change' })

test('‹ and › close the search row, after the count and ✕, plain, with no hotkey, carrying the borrowed actions', async ($, on) => {
  const world = host(on, session().jsonl())
  await start($, world)
  const pane = await mountPane($, 40)
  await type($, 'login')
  await world.clock.settle()

  const keys = drawnButtons(await pane.drawn()).map(b => b.key)
  const at = keys.indexOf('search.clear')
  expect(keys.slice(at, at + 3)).toEqual(['search.clear', 'walk.previous', 'walk.next'])
  const previous = await pane.find({ type: 'Button', key: 'walk.previous' })
  const next = await pane.find({ type: 'Button', key: 'walk.next' })
  expect([previous?.text, previous?.props.plain, previous?.props.hotkey, previous?.props.action]).toEqual(['‹', true, undefined, 'app:toggleDiffNoiseFilter'])
  expect([next?.text, next?.props.plain, next?.props.hotkey, next?.props.action]).toEqual(['›', true, undefined, 'app:toggleDiffPreSession'])
})

test('without a query ‹ › follow the field', async ($, on) => {
  const world = host(on, session().jsonl())
  await start($, world)
  const pane = await mountPane($, 40)
  const keys = drawnButtons(await pane.drawn()).map(b => b.key)
  expect(keys.slice(keys.indexOf('search.focus'), keys.indexOf('search.focus') + 3)).toEqual(['search.focus', 'walk.previous', 'walk.next'])
})

test('Desktop draws no ‹ ›: it cannot move the transcript', async ($, on) => {
  const world = host(on, session().jsonl())
  await start($, world)
  const pane = await $.ui.mount({
    plugin: 'chat-toc',
    surface: 'desktop',
    component: 'Pane',
    requestId: PANE,
    props: { title: '目录', isFocused: false, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  } as never)
  await world.clock.settle()
  const keys = drawnButtons(await pane.drawn()).map(b => b.key)
  expect(keys.length).toBeGreaterThan(0)
  expect(keys).not.toContain('walk.previous')
  expect(keys).not.toContain('walk.next')
})

test('the focus ring steps over ‹ ›: down from the search row lands on the first entry, up from it on the search row', async ($, on) => {
  const world = host(on, session().jsonl())
  await start($, world)
  await $.ui.mount({
    plugin: 'chat-toc',
    surface: 'terminal',
    component: 'Pane',
    requestId: PANE,
    viewport: { columns: 160, rows: 40, isFullscreen: true },
    props: { title: '目录', isFocused: true, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  })
  await world.clock.settle()
  const arrow = (element: string) => $.ui.focus({ component: 'Pane', requestId: PANE, element, origin: { kind: 'person' } } as never)
  await arrow('search')
  world.focuses.length = 0
  await arrow('walk.previous')
  expect(world.focuses.at(-1)?.element).toBe('g0.u')
  await arrow('walk.next')
  expect(world.focuses.at(-1)?.element).toBe('search')
})
