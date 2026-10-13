import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { drawHint, drawnButtons, host, mountPane, start } from './host'
import type { Host } from './host'
import { transcript } from './fixture'

/* CT-JUMP-005: in a session started by resume, the turns before the last
   compaction the file had then are drawn dim from the first drawing, and a
   press on one says why. CT-UI-005: a refusal is said at the bottom with a
   ⚠ in the theme's warning colour, flashing inverse three times first.

   The test engine refuses every transcript scroll (it has no transcript),
   which stands for the host refusing them. */

const COMPACTED = '⚠ 这一条在压缩之前，恢复会话后无法跳转'
const REFUSED = '⚠ 这一条当前没有显示在对话里，无法跳转'
const SESSION = { cwd: '/home/synthetic/project', surface: 'terminal', isInteractive: true } as const

type Pane = Awaited<ReturnType<typeof mountPane>>

function compactedSession() {
  const t = transcript()
  t.prompt('CT-SYN zero')
  t.reply([{ type: 'text', text: 'CT-SYN zero answer' }])
  t.prompt('CT-SYN one')
  t.reply([{ type: 'text', text: 'CT-SYN one answer' }])
  t.compact()
  t.prompt('CT-SYN two')
  t.reply([{ type: 'text', text: 'CT-SYN two answer' }])
  return t
}

async function resume($: Engine, world: Host) {
  await drawHint($)
  await $.classic.SessionStart({ source: 'resume', transcript_path: world.path })
  await $.session.start(SESSION)
  await world.clock.settle()
}

const dimOf = async (pane: Pane) => Object.fromEntries(drawnButtons(await pane.drawn()).map(b => [b.key, b.dimColor]))

/* The ⚠ line at the bottom: its text, colour and whether it is inverse. */
async function notice(pane: Pane) {
  const found = await pane.find({ type: 'Text', text: /^⚠ / })
  if (found === undefined) return undefined
  return { text: found.text, color: found.props.color, inverse: found.props.inverse === true }
}

test('after a resume the turns before the compaction are dim before anything is pressed, the rest not', async ($, on) => {
  const world = host(on, compactedSession().jsonl())
  await resume($, world)
  const pane = await mountPane($)

  /* An Agent reply side is always drawn dim; its User input side tells. */
  expect(await dimOf(pane)).toMatchObject({ 'g0.u': true, 'g1.u': true, 'g2.u': false })
  expect(await notice(pane)).toBeUndefined()
})

test('a session not started by resume dims nothing beforehand', async ($, on) => {
  const world = host(on, compactedSession().jsonl())
  await start($, world)
  const pane = await mountPane($)

  expect(await dimOf(pane)).toMatchObject({ 'g0.u': false, 'g1.u': false, 'g2.u': false })
})

test('a resumed session without a compaction dims nothing beforehand', async ($, on) => {
  const t = transcript()
  t.prompt('CT-SYN zero')
  t.reply([{ type: 'text', text: 'CT-SYN zero answer' }])
  const world = host(on, t.jsonl())
  await resume($, world)
  const pane = await mountPane($)

  expect(await dimOf(pane)).toMatchObject({ 'g0.u': false })
})

test('a compaction after the resume leaves the turns since the resume as they were', async ($, on) => {
  const t = compactedSession()
  const world = host(on, t.jsonl())
  await resume($, world)
  const pane = await mountPane($)

  t.compact()
  t.prompt('CT-SYN three')
  world.file = t.jsonl()
  await $.classic.SessionStart({ source: 'compact', transcript_path: world.path })
  await world.clock.settle()

  expect(await dimOf(pane)).toMatchObject({ 'g1.u': true, 'g2.u': false, 'g3.u': false })
})

test('a press on a turn from before the compaction says it cannot be reached after a resume', async ($, on) => {
  const world = host(on, compactedSession().jsonl())
  await resume($, world)
  const pane = await mountPane($)

  await pane.press({ key: 'g0.u' })

  expect(await notice(pane)).toEqual({ text: COMPACTED, color: 'warning', inverse: true })
})

test('any other refusal says the entry is not shown in the conversation', async ($, on) => {
  const world = host(on, compactedSession().jsonl())
  await resume($, world)
  const pane = await mountPane($)

  await pane.press({ key: 'g2.u' })

  expect((await notice(pane))?.text).toBe(REFUSED)
  expect((await dimOf(pane))['g2.u']).toBe(true)
})

test('the refusal flashes inverse three times over about a second, stays lit, and goes after five', async ($, on) => {
  const world = host(on, compactedSession().jsonl())
  await start($, world)
  const pane = await mountPane($)
  await pane.press({ key: 'g2.u' })

  const frames: boolean[] = []
  for (let i = 0; i < 8; i++) {
    frames.push((await notice(pane))?.inverse ?? false)
    await world.clock.advance(150)
  }
  expect(frames).toEqual([true, false, true, false, true, false, false, false])
  await world.clock.advance(5000 - 8 * 150 - 1)
  expect((await notice(pane))?.text).toBe(REFUSED)
  await world.clock.advance(1)
  expect(await notice(pane)).toBeUndefined()
})
