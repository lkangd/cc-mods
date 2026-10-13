import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { PANE, drawnButtons, host, mountPane, start } from './host'
import { transcript } from './fixture'

/* The footer at the pane's bottom: a rule, then what the list holds (or
   that following is paused) on the left and the Layout Button on the right. */

function three() {
  const t = transcript(new Date(2026, 9, 10, 9, 4).getTime())
  t.prompt('CT-SYN first')
  t.reply([{ type: 'text', text: 'CT-SYN first answer' }])
  t.localCommand('tui', '')
  t.prompt('CT-SYN third')
  t.reply([{ type: 'text', text: 'CT-SYN third answer' }])
  return t
}

function focusedPane($: Engine) {
  return $.ui.mount({
    plugin: 'chat-toc',
    surface: 'terminal',
    component: 'Pane',
    requestId: PANE,
    viewport: { columns: 160, rows: 40, isFullscreen: true },
    props: { title: '目录', isFocused: true, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  })
}

test('the footer counts the turn groups the list holds, dim, whatever the filter shows', async ($, on) => {
  await start($, host(on, three().jsonl()))
  const pane = await mountPane($)

  const count = await pane.find({ type: 'Text', text: '3 轮' })
  expect(count?.props.dimColor).toBe(true)
  await pane.press({ key: 'f-agent' })
  expect(await pane.find({ type: 'Text', text: '3 轮' })).toBeDefined()
})

test('the Layout Button is the last control, after every entry, and says the Layout in use', async ($, on) => {
  await start($, host(on, three().jsonl()))
  const pane = await mountPane($)

  const last = drawnButtons(await pane.drawn()).at(-1)
  expect([last?.key, last?.label]).toEqual(['layout', '布局 卡片'])
  await pane.press({ key: 'layout' })
  expect(drawnButtons(await pane.drawn()).at(-1)?.label).toBe('布局 紧凑')
})

test('a rule across the pane stands above the footer', async ($, on) => {
  await start($, host(on, three().jsonl()))
  const pane = await mountPane($)

  const rule = await pane.find({ type: 'Text', text: '─'.repeat(44) })
  expect(rule?.props.color).toBe('subtle')
})

test('while the keyboard is in the pane, the footer says following is paused instead of the count', async ($, on) => {
  await start($, host(on, three().jsonl()))
  const pane = await focusedPane($)

  const paused = await pane.find({ type: 'Text', text: '⏸ 暂停跟随' })
  expect(paused?.props.color).toBe('warning')
  expect(await pane.find({ type: 'Text', text: '3 轮' })).toBeUndefined()
})

test('a session with no conversation yet shows no count', async ($, on) => {
  await start($, host(on, transcript().jsonl()))
  const pane = await mountPane($)

  expect(await pane.find({ type: 'Text', text: /轮$/ })).toBeUndefined()
})
