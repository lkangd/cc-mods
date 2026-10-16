import { expect, test } from 'claude-code/testing'
import { PERF_LEAD, PERF_LINE_MAX, newPerf, note, takeLines } from '../hooks/perf'
import { appendRow, host, mountPane, start } from './host'
import { transcript } from './fixture'

/* The long-session timings (CT-PERF-001) go to the host's debug log only
   when CHAT_TOC_PERF is set, and are numbers only: no prompt text, uuid or
   path ever reaches a log (CT-SEC-001). */

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/

function sample() {
  const t = transcript()
  t.prompt('CT-SYN secret prompt one')
  t.reply([{ type: 'text', text: 'CT-SYN secret answer one' }])
  t.prompt('CT-SYN secret prompt two')
  t.reply([{ type: 'text', text: 'CT-SYN secret answer two' }])
  return t
}

const perfLines = (logs: { text: string }[]) => logs.filter(l => l.text.startsWith(PERF_LEAD))
const samplesOf = (logs: { text: string }[]) =>
  perfLines(logs).map(l => JSON.parse(l.text.slice(PERF_LEAD.length)) as Record<string, number[][]>)

test('without CHAT_TOC_PERF nothing is timed or logged', async ($, on) => {
  const world = host(on, sample().jsonl())
  await start($, world)
  const pane = await mountPane($)
  await pane.drawn()
  await world.clock.advance(2000)
  expect(world.logs).toEqual([])
})

test('with CHAT_TOC_PERF the reads and drawings are timed into the debug log, numbers only', async ($, on) => {
  const t = sample()
  const world = host(on, t.jsonl())
  world.env.CHAT_TOC_PERF = '1'
  await start($, world)
  const pane = await mountPane($)
  await pane.drawn()
  const asked = t.prompt('CT-SYN secret prompt three')
  world.file = t.jsonl()
  await appendRow($, asked)
  await world.clock.advance(300)
  await world.clock.advance(2000)

  expect(world.logs.length).toBeGreaterThan(0)
  for (const log of world.logs) {
    expect(log.to).toBe('debug')
    expect(log.text.startsWith(PERF_LEAD)).toBe(true)
    expect(log.text.includes('CT-SYN')).toBe(false)
    expect(UUID.test(log.text)).toBe(false)
    expect(log.text.includes(world.path)).toBe(false)
  }
  const merged: Record<string, number[][]> = {}
  for (const s of samplesOf(world.logs)) for (const [k, v] of Object.entries(s)) (merged[k] ??= []).push(...v)
  for (const metric of ['read.whole', 'read.tail', 'append.model', 'pane', 'listed']) expect(merged[metric]?.length ?? 0).toBeGreaterThan(0)
  for (const values of Object.values(merged).flat()) for (const v of values) expect(typeof v).toBe('number')
})

test('a sample keeps numbers only, rounded, and the lines take them once', () => {
  const perf = newPerf()
  expect(note(perf, 'pane', [1.23456, 2])).toBe(false)
  perf.isOn = true
  expect(note(perf, 'pane', [1.23456, Number.NaN])).toBe(true)
  expect(takeLines(perf)).toEqual([`${PERF_LEAD}{"pane":[[1.23,-1]]}`])
  expect(takeLines(perf)).toEqual([])
})

test('many samples go out in lines short enough for the debug log, none lost', () => {
  const perf = newPerf()
  perf.isOn = true
  for (let i = 0; i < 1000; i++) note(perf, 'position', [0.12345, 3000 + i, 8864])
  note(perf, 'pane', [1, 2, 3, 0])
  const lines = takeLines(perf)
  expect(lines.length).toBeGreaterThan(1)
  for (const line of lines) expect(line.length).toBeLessThanOrEqual(PERF_LINE_MAX)
  const back = lines.map(l => JSON.parse(l.slice(PERF_LEAD.length)) as Record<string, number[][]>)
  expect(back.flatMap(b => b.position ?? []).map(s => s[1])).toEqual(Array.from({ length: 1000 }, (_, i) => 3000 + i))
  expect(back.flatMap(b => b.pane ?? [])).toEqual([[1, 2, 3, 0]])
})

test('with CHAT_TOC_PERF a keystroke in the search field is timed to the redrawn Pane, and the index build too, numbers only', async ($, on) => {
  const world = host(on, sample().jsonl())
  world.env.CHAT_TOC_PERF = '1'
  await start($, world)
  const pane = await mountPane($)
  await pane.drawn()
  await $.ui.input({ plugin: 'chat-toc', key: 'search', text: 'CT-SYN secret', kind: 'change' })
  await world.clock.settle()
  await $.ui.input({ plugin: 'chat-toc', key: 'search', text: 'CT-SYN secret two', kind: 'change' })
  await world.clock.settle()
  await world.clock.advance(2000)

  for (const log of world.logs) expect(log.text.includes('CT-SYN')).toBe(false)
  const merged: Record<string, number[][]> = {}
  for (const s of samplesOf(world.logs)) for (const [k, v] of Object.entries(s)) (merged[k] ??= []).push(...v)
  /* [own ms, ms since the keystroke, matches, groups] per keystroke. */
  expect(merged.search?.map(s => s.slice(2))).toEqual([
    [2, 2],
    [1, 2],
  ])
  for (const [own, total] of merged.search ?? []) expect(total!).toBeGreaterThanOrEqual(own!)
  /* [ms, groups built, groups] per read that regrouped. */
  expect(merged.index?.map(s => s.slice(1))).toEqual([[2, 2]])
})
