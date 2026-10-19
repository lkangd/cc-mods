import { expect, test } from 'claude-code/testing'
import { drawnButtons, host, isBarKey, mountPane, start } from './host'
import { transcript } from './fixture'

/* Ticket 38: the Minimap over the terminal list, one cell per Turn group, a
   press on it jumping as the group's entry does. */

const text = (s: string) => ({ type: 'text', text: s })
const tool = (id: string) => ({ type: 'tool_use', id, name: 'Bash', input: {} })

/* Four groups with 0, 1, 4 and 16 steps; the first at 09:05, the last at
   09:21. */
function session() {
  const t = transcript(new Date(2026, 9, 10, 9, 4).getTime())
  const asked: string[] = []
  for (const [i, steps] of [0, 1, 4, 16].entries()) {
    asked.push(t.prompt(`CT-SYN prompt ${i}`))
    for (let s = 0; s < steps; s++) {
      t.reply([tool(`t${i}-${s}`)])
      t.toolResult(`t${i}-${s}`)
    }
    t.reply([text(`CT-SYN answer ${i}`)])
  }
  return { t, asked }
}

const cells = async (pane: Awaited<ReturnType<typeof mountPane>>) =>
  drawnButtons(await pane.drawn()).filter(b => isBarKey(b.key))

test('a cell per group sits between the filter row and the entries, as tall as its steps', async ($, on) => {
  const { t } = session()
  await start($, host(on, t.jsonl()))
  const pane = await mountPane($)

  const all = drawnButtons(await pane.drawn()).map(b => String(b.key))
  expect(all.slice(0, 10)).toEqual(['f-all', 'f-user', 'f-agent', 'search.focus', 'walk.previous', 'walk.next', 'm.0', 'm.1', 'm.2', 'm.3'])
  expect((await cells(pane)).map(b => b.label)).toEqual(['▁', '▃', '▅', '█'])
})

test('the cells are dim but the Current position’s, and none lit when there is no position', async ($, on) => {
  const { t } = session()
  await start($, host(on, t.jsonl()))
  const pane = await mountPane($)

  expect((await cells(pane)).map(b => b.dimColor)).toEqual([true, true, true, true])
})

test('the first and last group’s times stand under the cells', async ($, on) => {
  const { t } = session()
  await start($, host(on, t.jsonl()))
  const pane = await mountPane($)

  expect(await pane.find({ type: 'Text', text: /^10月10日 09:05 +09:21$/ })).toBeDefined()
})

test('a press on a cell goes to its group: the host refusing it, that cell drops to the floor, the rest stay', async ($, on) => {
  const { t } = session()
  await start($, host(on, t.jsonl()))
  const pane = await mountPane($)

  /* The test engine refuses every scroll, as a host refusing the row. */
  await pane.press({ key: 'm.2' })

  expect((await cells(pane)).map(b => b.label)).toEqual(['▁', '▃', '▁', '█'])
  expect(await pane.find({ type: 'Text', text: /没有显示在对话里/ })).toBeDefined()
})

test('the View filter does not change the cells', async ($, on) => {
  const { t } = session()
  await start($, host(on, t.jsonl()))
  const pane = await mountPane($)

  await pane.press({ key: 'f-agent' })

  expect((await cells(pane)).map(b => b.label)).toEqual(['▁', '▃', '▅', '█'])
})

test('one group, or too few rows for the list, draw none', async ($, on) => {
  const one = transcript()
  one.prompt('CT-SYN only')
  one.reply([text('CT-SYN answer')])
  await start($, host(on, one.jsonl()))
  expect(await cells(await mountPane($))).toEqual([])
})

test('with rows for the list to keep eight, the Minimap is drawn; with fewer, it leaves', async ($, on) => {
  const { t } = session()
  await start($, host(on, t.jsonl()))

  /* The head, the search row and the footer take five rows, the Minimap
     three; the preview is closed. */
  expect((await cells(await mountPane($, 16))).length).toBe(4)
})

test('with one row fewer the list keeps its rows and the Minimap goes', async ($, on) => {
  const { t } = session()
  await start($, host(on, t.jsonl()))

  expect(await cells(await mountPane($, 15))).toEqual([])
})

test('past the cells the width holds, a cell stands for several groups, the first cell the first group', async ($, on) => {
  const t = transcript()
  for (let i = 0; i < 100; i++) {
    t.prompt(`CT-SYN prompt ${i}`)
    t.reply([text(`CT-SYN answer ${i}`)])
  }
  await start($, host(on, t.jsonl()))
  const pane = await mountPane($)

  /* 44 columns hold 44 cells: three groups to a cell, 34 cells. */
  expect((await cells(pane)).length).toBe(34)
})

test('the width the groups do not reach is a dim baseline, and a blank row parts the Minimap from the list', async ($, on) => {
  const { t } = session()
  await start($, host(on, t.jsonl()))
  const pane = await mountPane($)

  /* Four cells of the 44 columns; the other 40 are the baseline, not Buttons. */
  const baseline = await pane.find({ type: 'Text', text: '▁'.repeat(40) })
  expect(baseline?.props.color).toBe('subtle')
  const tree = JSON.stringify(await pane.drawn())
  const labels = tree.indexOf('10月10日 09:05')
  const firstEntry = tree.indexOf('"row-g0.u"')
  expect(tree.slice(labels, firstEntry)).toContain('" "')
})

test('a filter that hides every entry does not say the session is empty while the Minimap shows its turns', async ($, on) => {
  const t = transcript()
  t.localCommand('tui', '')
  t.localCommand('help', '')
  await start($, host(on, t.jsonl()))
  const pane = await mountPane($, 23)

  await pane.press({ key: 'f-agent' })

  expect((await cells(pane)).length).toBe(2)
  expect(await pane.find({ type: 'Text', text: /本会话还没有对话/ })).toBeUndefined()
})
