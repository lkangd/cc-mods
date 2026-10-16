import { expect, test } from 'claude-code/testing'
import { drawnButtons, entryTexts, host, isEntryKey, mountPane, start } from './host'
import { transcript } from './fixture'
import type { Builder } from './fixture'

/* CT-CMPCT-001 at the element tree: a dashed rule where each compaction
   fell, between the groups shown, in every Layout and under every View
   filter; the fork line at the list's top. The Chinese words: host.ts sets
   LANG to Chinese. */

const text = (t: string) => [{ type: 'text', text: t }]
const DASHES = /^╌ /

function turn(t: Builder, prompt: string) {
  t.prompt(prompt)
  t.reply(text(`${prompt} answer`))
}

/* The compaction rules drawn, in order, each row's Texts joined. */
async function ruleRows(pane: { findAll: (q: { type: string }) => Promise<{ key: string | undefined; text: string }[]> }) {
  return (await pane.findAll({ type: 'Box' }))
    .filter(b => b.key?.startsWith('compaction-'))
    .map(b => b.text)
    .filter(s => DASHES.test(s))
}

const local = (iso: string) => {
  const at = new Date(iso)
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

function manual(): { t: Builder; time: string } {
  const t = transcript()
  turn(t, 'CT-SYN zero')
  const boundary = t.compact('manual')
  t.command('compact', '', 'local')
  turn(t, 'CT-SYN after')
  const time = local(t.rows.find(r => r.uuid === boundary)!.timestamp as string)
  return { t, time }
}

test('a manual compaction draws a dashed rule after the /compact entry, its time the boundary row’s', async ($, on) => {
  const { t, time } = manual()
  await start($, host(on, t.jsonl()))
  const pane = await mountPane($)

  /* 44 cells: `╌ `, the words (12 cells), a space, 29 dashes. */
  expect(await ruleRows(pane)).toEqual([`╌ 已压缩 ${time} ${'╌'.repeat(29)}`])
  const order = drawnButtons(await pane.drawn())
    .filter(b => isEntryKey(b.key))
    .map(b => b.key)
  expect(order).toEqual(['g0.u', 'g0.a', 'g1.u', 'g2.u', 'g2.a'])
  const rule = await pane.find({ type: 'Text', text: `已压缩 ${time}` })
  expect(rule?.props.dimColor).toBe(true)
  expect(drawnButtons(await pane.drawn()).some(b => typeof b.label === 'string' && b.label.includes('已压缩'))).toBe(false)
})

test('the rule shows in every Layout and under every View filter, and entries above it are not dimmed', async ($, on) => {
  const { t } = manual()
  await start($, host(on, t.jsonl()))
  const pane = await mountPane($)

  for (const press of ['layout', 'layout', 'f-user']) {
    await pane.press({ key: press })
    expect((await ruleRows(pane)).length).toBe(1)
  }
  const above = drawnButtons(await pane.drawn()).find(b => b.key === 'g0.u')
  expect(above?.dimColor).toBe(false)
  await pane.press({ key: 'f-agent' })
  expect((await ruleRows(pane)).length).toBe(1)
  expect(await entryTexts(pane)).toEqual(['CT-SYN zero answer', 'CT-SYN after answer'])
})

test('three compactions between two shown groups fold into one rule with the last one’s time', async ($, on) => {
  const t = transcript()
  turn(t, 'CT-SYN zero')
  t.compact('auto')
  t.compact('auto')
  const last = t.compact('auto')
  turn(t, 'CT-SYN one')
  const time = local(t.rows.find(r => r.uuid === last)!.timestamp as string)
  await start($, host(on, t.jsonl()))
  const pane = await mountPane($)

  const rows = await ruleRows(pane)
  expect(rows.length).toBe(1)
  expect(rows[0]?.startsWith(`╌ 自动压缩 ×3 · ${time} ╌`)).toBe(true)
})

test('a file starting at a foreign boundary shows the fork line, dim, above the first rule', async ($, on) => {
  const t = transcript()
  t.compact('manual')
  t.rows[0]!.logicalParentUuid = '99999999-0000-4000-8000-999999999999'
  t.command('compact', '', 'local')
  turn(t, 'CT-SYN forked')
  await start($, host(on, t.jsonl()))
  const pane = await mountPane($)

  const line = await pane.find({ type: 'Text', text: '更早的轮次不在本会话的文件里' })
  expect(line?.props.dimColor).toBe(true)
  const texts = (await pane.findAll({ type: 'Text' })).map(x => x.text)
  expect(texts.indexOf('更早的轮次不在本会话的文件里')).toBeLessThan(texts.findIndex(s => s.startsWith('已压缩')))
})

test('a file holding the whole conversation shows no fork line', async ($, on) => {
  const { t } = manual()
  await start($, host(on, t.jsonl()))
  const pane = await mountPane($)

  expect(await pane.find({ type: 'Text', text: '更早的轮次不在本会话的文件里' })).toBeUndefined()
})
