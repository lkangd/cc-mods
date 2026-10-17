import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { PANE, appendRow, drawnButtons, host, isEntryKey, start } from './host'
import { LIST_BUDGET } from '../hooks/desktop'
import { setLanguage, text as words } from '../hooks/text'
import { transcript } from './fixture'

/* Scrolling on Claude Code Desktop (spec §8, ticket 23): the host scrolls
   the Pane's whole tree, so the person's scroll passes through and the list
   is not windowed by rows. A tree is bounded at 100,000 serialized
   characters, so the list draws the newest entries within a budget, with
   Buttons moving the drawn part to earlier and later turns. */

function session(turns: number, reply = (i: number) => `CT-SYN T${i} answer: module ${i} checks out, nothing to do.`) {
  const t = transcript(new Date(2026, 9, 10, 9, 4).getTime())
  for (let i = 0; i < turns; i++) {
    t.prompt(`CT-SYN T${i} a question about module ${i}, long enough that it folds onto a second line in the pane`)
    t.reply([{ type: 'text', text: reply(i) }])
  }
  return t
}

function desktopPane($: Engine, bodyRows = 30) {
  return $.ui.mount({
    plugin: 'chat-toc',
    surface: 'desktop',
    component: 'Pane',
    requestId: PANE,
    props: { title: '目录', isFocused: false, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows }, view: {} },
  } as never)
}

type Pane = Awaited<ReturnType<typeof desktopPane>>
type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

const entryKeys = async (pane: Pane) => drawnButtons(await pane.drawn()).filter(b => isEntryKey(b.key)).map(b => String(b.key))
/* The groups with an entry drawn, in order. */
async function drawnGroups(pane: Pane): Promise<number[]> {
  const groups = (await entryKeys(pane)).map(k => Number(/^g(\d+)\./.exec(k)![1]))
  return groups.filter((g, i) => i === 0 || g !== groups[i - 1])
}
const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i)
const label = async (pane: Pane, key: string) => (await pane.find({ type: 'Button', key }))?.text

/* The serialized characters of the drawn list: the Box holding the
   entries' rows. */
async function listChars(pane: Pane): Promise<number> {
  const root = (await pane.drawn()) as Node
  const list = (root.children ?? []).find(c => JSON.stringify(c).includes('"row-g'))
  return JSON.stringify(list).length
}

test('a short session draws every entry, taller than the pane though it is, and no earlier or later Button', async ($, on) => {
  await start($, host(on, session(10).jsonl()))
  const pane = await desktopPane($, 30)

  expect(await drawnGroups(pane)).toEqual(range(0, 10))
  expect(await pane.find({ type: 'Button', key: 'list.earlier' })).toBeUndefined()
  expect(await pane.find({ type: 'Button', key: 'list.later' })).toBeUndefined()
})

test('a long session draws the newest groups within the budget, whole, under a ↑ Button counting the rest', async ($, on) => {
  await start($, host(on, session(60).jsonl()))
  const pane = await desktopPane($)

  const drawn = await drawnGroups(pane)
  expect(drawn[drawn.length - 1]).toBe(59)
  expect(drawn).toEqual(range(drawn[0]!, 60))
  /* Each drawn group with both its sides. */
  expect((await entryKeys(pane)).filter(k => /^g\d+\.[ua]$/.test(k)).length).toBe(drawn.length * 2)
  expect(drawn.length).toBeGreaterThanOrEqual(10)
  expect(drawn.length).toBeLessThan(60)
  expect(await label(pane, 'list.earlier')).toBe(`↑ 更早的 ${60 - drawn.length} 轮`)
  expect(await pane.find({ type: 'Button', key: 'list.later' })).toBeUndefined()
  /* The budget holds as the tree serializes, give or take its reckoning. */
  expect(await listChars(pane)).toBeLessThan(LIST_BUDGET * 1.05)
  expect(await listChars(pane)).toBeGreaterThan(LIST_BUDGET * 0.85)
  /* At the list's top. */
  const order = JSON.stringify(await pane.drawn())
  expect(order.indexOf('"list.earlier"')).toBeLessThan(order.indexOf(`"g${drawn[0]}.u"`))
})

test('↑ moves the drawn part to the turns before it, ↓ at its bottom moves it back to the newest', async ($, on) => {
  const world = host(on, session(60).jsonl())
  await start($, world)
  const pane = await desktopPane($)
  const newest = await drawnGroups(pane)

  await pane.press({ key: 'list.earlier' })
  await world.clock.settle()
  const earlier = await drawnGroups(pane)
  expect(earlier[earlier.length - 1]).toBe(newest[0]! - 1)
  expect(earlier).toEqual(range(earlier[0]!, newest[0]!))
  expect(await label(pane, 'list.later')).toBe(`↓ 更晚的 ${60 - newest[0]!} 轮`)
  expect(earlier[0]! > 0 ? await label(pane, 'list.earlier') : undefined).toBe(earlier[0]! > 0 ? `↑ 更早的 ${earlier[0]} 轮` : undefined)
  /* At the list's bottom. */
  const order = JSON.stringify(await pane.drawn())
  expect(order.indexOf(`"g${earlier[earlier.length - 1]}.a"`)).toBeLessThan(order.indexOf('"list.later"'))

  await pane.press({ key: 'list.later' })
  await world.clock.settle()
  expect(await drawnGroups(pane)).toEqual(newest)
  expect(await pane.find({ type: 'Button', key: 'list.later' })).toBeUndefined()
})

test('pressed all the way up the first group is drawn and no ↑ is left; a new turn keeps the drawn part where it was', async ($, on) => {
  const t = session(60)
  const world = host(on, t.jsonl())
  await start($, world)
  const pane = await desktopPane($)

  for (let n = 0; n < 10 && (await pane.find({ type: 'Button', key: 'list.earlier' })) !== undefined; n++) {
    await pane.press({ key: 'list.earlier' })
    await world.clock.settle()
  }
  const first = await drawnGroups(pane)
  expect(first[0]).toBe(0)
  expect(await pane.find({ type: 'Button', key: 'list.earlier' })).toBeUndefined()
  const later = 60 - first.length

  const asked = t.prompt('CT-SYN T60 one more')
  const answered = t.reply([{ type: 'text', text: 'CT-SYN T60 answer' }])
  world.file = t.jsonl()
  await appendRow($, asked)
  await appendRow($, answered)
  await world.clock.advance(300)
  expect(await drawnGroups(pane)).toEqual(first)
  expect(await label(pane, 'list.later')).toBe(`↓ 更晚的 ${later + 1} 轮`)
})

test('a query narrows the list before the budget applies, and a new query draws its newest matches', async ($, on) => {
  const world = host(on, session(60).jsonl())
  await start($, world)
  const pane = await desktopPane($)
  await pane.press({ key: 'list.earlier' })
  await world.clock.settle()

  /* T1 and T10 to T19: eleven groups, which fit. */
  await $.ui.input({ plugin: 'chat-toc', key: 'search', text: 'T1 ', kind: 'change' })
  await world.clock.settle()
  expect(await drawnGroups(pane)).toEqual([1, ...range(10, 20)])
  expect(await pane.find({ type: 'Button', key: 'list.earlier' })).toBeUndefined()
  expect(await pane.find({ type: 'Button', key: 'list.later' })).toBeUndefined()

  /* Every group matches: too many, so the newest within the budget. */
  await $.ui.input({ plugin: 'chat-toc', key: 'search', text: 'module', kind: 'change' })
  await world.clock.settle()
  const drawn = await drawnGroups(pane)
  expect(drawn[drawn.length - 1]).toBe(59)
  expect(await label(pane, 'list.earlier')).toBe(`↑ 更早的 ${60 - drawn.length} 轮`)
})

test('the User filter draws more groups in the same budget, its ↑ counting the groups left out', async ($, on) => {
  const world = host(on, session(60).jsonl())
  await start($, world)
  const pane = await desktopPane($)
  const all = (await drawnGroups(pane)).length

  await pane.press({ key: 'f-user' })
  await world.clock.settle()
  const users = await drawnGroups(pane)
  expect(users.length).toBeGreaterThan(all)
  expect(users[users.length - 1]).toBe(59)
  expect(await label(pane, 'list.earlier')).toBe(`↑ 更早的 ${60 - users.length} 轮`)
})

test('a 2,000-turn session with a long reply open in the preview stays under 100,000 serialized characters in every Layout', async ($, on) => {
  const long = Array.from({ length: 400 }, (_, i) => `CT-SYN paragraph ${i}: ${'lorem ipsum dolor sit amet '.repeat(3)}`).join('\n\n')
  const world = host(on, session(2000, i => (i === 1999 ? long : `CT-SYN T${i} answer`)).jsonl())
  await start($, world)
  const pane = await desktopPane($, 42)

  for (const layout of ['card', 'compact', 'timeline']) {
    await (pane as unknown as { select: (target: { key: string; value: string }) => Promise<unknown> }).select({ key: 'layout', value: layout })
    await world.clock.settle()
    const tree = JSON.stringify(await pane.drawn())
    expect(tree).toContain('CT-SYN paragraph 0')
    const size = tree.length
    expect(size).toBeLessThan(80_000)
    expect((await drawnGroups(pane)).length).toBeGreaterThanOrEqual(10)
    expect(await label(pane, 'list.earlier')).toMatch(/^↑ 更早的 \d+ 轮$/)
  }
})

test("on the desktop the person's scroll passes to the host and the drawn part stays", async ($, on) => {
  const world = host(on, session(60).jsonl())
  await start($, world)
  const pane = await desktopPane($)
  const drawn = await drawnGroups(pane)

  await $.ui.scroll({ component: 'Pane', requestId: PANE, offset: 0, by: -3, bodyRows: 30, contentRows: 200, origin: { kind: 'person' } } as never)
  await world.clock.settle()
  expect(world.scrolls.length).toBe(1)
  expect(await drawnGroups(pane)).toEqual(drawn)
})

test('the Buttons say how many turns, in English and Chinese', () => {
  setLanguage('en')
  expect([words.earlierTurns(1), words.earlierTurns(12), words.laterTurns(1), words.laterTurns(3)]).toEqual([
    '↑ 1 earlier turn',
    '↑ 12 earlier turns',
    '↓ 1 later turn',
    '↓ 3 later turns',
  ])
  setLanguage('zh')
  expect([words.earlierTurns(12), words.laterTurns(3)]).toEqual(['↑ 更早的 12 轮', '↓ 更晚的 3 轮'])
})
