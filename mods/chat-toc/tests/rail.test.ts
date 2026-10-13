import { expect, test } from 'claude-code/testing'
import { host, mountPane, start } from './host'
import { transcript } from './fixture'
import type { Builder } from './fixture'

/* The rail the entries hang on, as the pane draws it: a node beside a User
   input's first line, a branch beside an Agent reply's, the rail beside the
   lines after and through the gap to the next group, the day's rule where
   the day changes, and the time: at the right of a card's prompt, in a
   column left of the rail in compact and timeline. */

type Pane = Awaited<ReturnType<typeof mountPane>>
type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

const own = (el: Node) => (el.children ?? []).filter((c): c is string => typeof c === 'string').join('')
const tone = (el: Node) => (el.props?.dimColor === true ? 'dim' : (el.props?.color as string | undefined))

/* Every Text drawn in entry `key`'s row, outside its Buttons, in order:
   its text and its colour (`dim` for dimColor). */
async function marks(pane: Pane, key: string): Promise<[string, string | undefined][]> {
  const out: [string, string | undefined][] = []
  let row: Node | undefined
  const find = (node: unknown) => {
    if (typeof node !== 'object' || node === null || row) return
    const el = node as Node
    if (el.type === 'Box' && el.props?.key === `row-${key}`) row = el
    else for (const child of el.children ?? []) find(child)
  }
  find(await pane.drawn())
  const walk = (node: unknown) => {
    if (typeof node !== 'object' || node === null) return
    const el = node as Node
    if (el.type === 'Button') return
    if (el.type === 'Text') out.push([own(el), tone(el)])
    for (const child of el.children ?? []) walk(child)
  }
  walk(row)
  return out
}

function at(t: Builder, uuid: string, when: Date) {
  const row = t.rows.find(r => r.uuid === uuid)
  if (row) row.timestamp = when.toISOString()
}

/* A two-line prompt with a reply, a prompt on the same day, then one on
   the next day (today, in the test's clock). */
function session(): Builder {
  const t = transcript()
  at(t, t.prompt('CT-SYN a prompt long enough to take a second line of the card'), new Date(2026, 9, 9, 22, 41))
  t.reply([{ type: 'text', text: 'CT-SYN answer' }])
  at(t, t.prompt('CT-SYN same day'), new Date(2026, 9, 9, 22, 58))
  at(t, t.prompt('CT-SYN next day'), new Date(2026, 9, 10, 9, 2))
  return t
}

test("in the card each side hangs on the rail, the prompt's time at its right, the day's rule above the first group", async ($, on) => {
  await start($, host(on, session().jsonl()))
  const pane = await mountPane($)

  expect(await marks(pane, 'g0.u')).toEqual([
    ['─ ', 'subtle'],
    ['10月9日', 'dim'],
    [' ' + '─'.repeat(44 - 2 - 7 - 1), 'subtle'],
    ['●  ', 'dim'],
    ['│  ', 'subtle'],
    ['22:41', 'dim'],
  ])
  /* The rail goes on through the gap to the next group of the day. */
  expect(await marks(pane, 'g0.a')).toEqual([
    ['├╴ ', 'subtle'],
    ['│', 'subtle'],
  ])
})

test('before a new day the gap is blank and the rule says the day', async ($, on) => {
  await start($, host(on, session().jsonl()))
  const pane = await mountPane($)

  expect((await marks(pane, 'g1.u')).at(-1)).toEqual([' ', undefined])
  expect((await marks(pane, 'g2.u')).slice(0, 2)).toEqual([
    ['─ ', 'subtle'],
    ['今天 · 10月10日', 'dim'],
  ])
})

test('compact and timeline put the time in a column left of the rail, on the first side of a group', async ($, on) => {
  await start($, host(on, session().jsonl()))
  const pane = await mountPane($)
  await pane.press({ key: 'layout' })

  expect((await marks(pane, 'g0.u')).slice(3)).toEqual([
    ['22:41 ', 'dim'],
    ['●  ', 'dim'],
  ])
  expect(await marks(pane, 'g0.a')).toEqual([
    ['      ', 'dim'],
    ['├╴ ', 'subtle'],
  ])

  await pane.press({ key: 'layout' })
  expect((await marks(pane, 'g0.u')).slice(3)).toEqual([
    ['22:41 \n      ', 'dim'],
    ['●  ', 'dim'],
    ['│  ', 'subtle'],
  ])
})

test('a running Agent reply is marked ◐ beside its branch', async ($, on) => {
  const t = transcript()
  t.prompt('CT-SYN working')
  const world = host(on, t.jsonl())
  await start($, world)
  await $.turn.start({ text: 'CT-SYN working', turnId: 'turn-1' })
  await world.clock.advance(300)
  const pane = await mountPane($)

  expect(await marks(pane, 'g0.a')).toEqual([
    ['├╴ ', 'subtle'],
    ['◐ ', 'claude'],
  ])
})

/* CT-JUMP-003, CT-JUMP-005: a side with no Jump target hangs on a hollow
   mark, the Agent reply's as well as the User input's, its text dim as an
   Agent reply's always is. The test engine refuses every jump. */
test('a side whose jump was refused hangs on a hollow mark, the rest as they were', async ($, on) => {
  await start($, host(on, session().jsonl()))
  const pane = await mountPane($)

  await pane.press({ key: 'g0.a' })
  expect((await marks(pane, 'g0.a'))[0]).toEqual(['├┄ ', 'subtle'])
  await pane.press({ key: 'g1.u' })
  expect((await marks(pane, 'g1.u'))[0]).toEqual(['○  ', 'subtle'])
  expect((await marks(pane, 'g0.u'))[3]).toEqual(['●  ', 'dim'])
})
