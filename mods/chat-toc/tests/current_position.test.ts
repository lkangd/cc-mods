import { expect, test } from 'claude-code/testing'
import { currentChain } from '../hooks/chain'
import { groupTurns } from '../hooks/groups'
import { addDrawable, drawableRows, groupOfRow, lockOn, openerRows, positionOf, quietAfter, siteReport, trustedRun } from '../hooks/position'
import type { LiveRow } from '../hooks/position'
import { newSites, noteSite, rowIndex } from '../hooks/sites'
import { parseTranscript } from '../hooks/transcript'
import { transcript } from './fixture'

/* Current position: the Turn group of the row at the top of the
   transcript's view. The host unmounts rows without always saying so, so
   only the run of on-screen rows that holds the latest report is trusted:
   two on-screen rows with a drawable row between them that is not on
   screen are not on screen together. */

const live = (order: number, seq: number, first = 0, last = 2, of = 3): LiveRow => ({ order, seq, onScreen: { first, last, of } })

test('rows next to each other on the chain are one run, its first row the top', () => {
  const run = trustedRun([live(4, 1), live(5, 2), live(7, 3)], [1, 4, 5, 7, 9])
  expect(run?.map(r => r.order)).toEqual([4, 5, 7])
})

test('a drawable row off screen between two on-screen rows cuts them apart; the latest report picks the run', () => {
  /* Row 2 was drawn long ago and never said it left; row 6 lies between it
     and the rows the view shows now. */
  const rows = [live(2, 5), live(7, 1), live(8, 2)]
  expect(trustedRun(rows, [2, 6, 7, 8])?.map(r => r.order)).toEqual([2])
  expect(trustedRun([live(2, 1), live(7, 2), live(8, 3)], [2, 6, 7, 8])?.map(r => r.order)).toEqual([7, 8])
})

test('rows that are not drawable between two on-screen rows do not cut them', () => {
  /* Tool results, hook rows and the like are drawn at no site. */
  expect(trustedRun([live(3, 1), live(9, 2)], [3, 9, 12])?.map(r => r.order)).toEqual([3, 9])
})

test('nothing on screen has no run', () => {
  expect(trustedRun([], [1, 2])).toBeUndefined()
})

test('the drawable rows are the User inputs, the main agent text and every row a site drew, in chain order', () => {
  const t = transcript()
  const asked = t.prompt('CT-SYN one')
  const tools = t.reply([{ type: 'tool_use', id: 'toolu_01', name: 'Bash', input: {} }])
  t.toolResult('toolu_01')
  const said = t.reply([{ type: 'text', text: 'CT-SYN done' }])
  t.localCommand('model', '')
  const output = t.localOutput('Set model to synthetic')
  const chain = currentChain(parseTranscript(t.jsonl()).rows)
  const rows = rowIndex(chain)
  const sites = newSites()
  const order = (uuid: string) => rows.order.get(uuid) as number

  /* A command's output is drawn at a site in the session that ran it, but
     not when the session is resumed: it counts once a site drew it. */
  expect(drawableRows(rows, sites)).toEqual([order(asked), order(said)])

  noteSite(sites, rows, 'ToolGroup', 'toolu_01', { first: 0, last: 0, of: 1 })
  noteSite(sites, rows, 'CommandOutput', output, { first: 0, last: 0, of: 1 })
  expect(drawableRows(rows, sites)).toEqual([order(asked), order(tools), order(said), order(output)])
  /* A row drawn since the last rebuild goes in its place. */
  const kept = [order(asked), order(said)]
  addDrawable(kept, order(tools))
  addDrawable(kept, order(tools))
  expect(kept).toEqual([order(asked), order(tools), order(said)])
})

function session() {
  const t = transcript()
  t.row({ type: 'system', subtype: 'informational', content: 'CT-SYN before any prompt' })
  const one = t.prompt('CT-SYN one')
  const oneSaid = t.reply([{ type: 'text', text: 'CT-SYN one done' }])
  t.compact()
  const two = t.prompt('CT-SYN two')
  const twoSaid = t.reply([{ type: 'text', text: 'CT-SYN two done' }])
  const three = t.prompt('CT-SYN three')
  const threeSaid = t.reply([{ type: 'text', text: 'CT-SYN three done' }])
  const chain = currentChain(parseTranscript(t.jsonl()).rows)
  const rows = rowIndex(chain)
  const groups = groupTurns(chain)
  const openers = openerRows(groups, rows)
  const order = (uuid: string) => rows.order.get(uuid) as number
  return { chain, rows, groups, openers, order, one, oneSaid, two, twoSaid, three, threeSaid }
}

test('a row belongs to the group opened last before it; a row before every group to none', () => {
  const s = session()
  expect(groupOfRow(s.openers, s.order(s.oneSaid))).toBe(0)
  expect(groupOfRow(s.openers, s.order(s.two))).toBe(1)
  expect(groupOfRow(s.openers, s.order(s.threeSaid))).toBe(2)
  /* The compact boundary and its summary sit after group 0's rows. */
  expect(groupOfRow(s.openers, s.order(s.two) - 1)).toBe(0)
  expect(groupOfRow(s.openers, 0)).toBeUndefined()
})

test('the position is the group of the trusted run first row', () => {
  const s = session()
  const drawable = [s.one, s.oneSaid, s.two, s.twoSaid, s.three, s.threeSaid].map(s.order)
  const at = positionOf({
    live: [live(s.order(s.oneSaid), 9), live(s.order(s.twoSaid), 1), live(s.order(s.three), 2, 0, 2, 9)],
    drawable,
    openers: s.openers,
    lastDrawn: s.order(s.threeSaid),
    groups: s.groups.length,
    locked: undefined,
  })
  /* oneSaid's report is the latest: its run is itself alone. */
  expect(at).toBe(0)
})

test('the last drawn row wholly on screen lights the last group, whatever the top', () => {
  const s = session()
  const drawable = [s.one, s.oneSaid, s.two, s.twoSaid, s.three, s.threeSaid].map(s.order)
  const base = { drawable, openers: s.openers, lastDrawn: s.order(s.threeSaid), groups: s.groups.length, locked: undefined }
  const top = live(s.order(s.twoSaid), 1, 3, 5, 6)
  const middle = live(s.order(s.three), 2)
  expect(positionOf({ ...base, live: [top, middle, live(s.order(s.threeSaid), 3, 0, 4, 5)] })).toBe(2)
  /* Its bottom line still below the view: the top's group. */
  expect(positionOf({ ...base, live: [top, middle, live(s.order(s.threeSaid), 3, 0, 3, 5)] })).toBe(1)
})

test('a lock holds the jumped-to group whatever is on screen', () => {
  const s = session()
  const at = positionOf({
    live: [live(s.order(s.twoSaid), 1)],
    drawable: [s.order(s.twoSaid)],
    openers: s.openers,
    lastDrawn: s.order(s.threeSaid),
    groups: s.groups.length,
    locked: 0,
  })
  expect(at).toBe(0)
})

const ROWS = { first: 0, last: 2, of: 3 }

test("while a jump's redraws keep coming, a row leaving the view holds the lock", () => {
  const got = siteReport(lockOn(4), ROWS, null)
  expect(got.lock?.group).toBe(4)
  expect(got.quietAfter).toBe(1)
  expect(got.isPlaced).toBe(true)
})

test("the first row to leave the view after a jump's redraws stop lets the lock go and places the view again", () => {
  const lock = lockOn(4)
  quietAfter(lock, 0)

  const got = siteReport(lock, ROWS, null)

  expect(got.lock).toBeUndefined()
  expect(got.quietAfter).toBeUndefined()
  /* So the highlight leaves the jumped-to group now, not at the next report. */
  expect(got.isPlaced).toBe(true)
})

test('a report that says nothing of the view neither moves a lock nor places the view', () => {
  const lock = lockOn(4)
  quietAfter(lock, 0)
  expect(siteReport(lock, ROWS, undefined)).toEqual({ lock, quietAfter: undefined, isPlaced: false })
  expect(siteReport(undefined, undefined, ROWS)).toEqual({ lock: undefined, quietAfter: undefined, isPlaced: true })
})

test('nothing on screen, or only rows before every group, lights nothing', () => {
  const s = session()
  const base = { drawable: [], openers: s.openers, lastDrawn: undefined, groups: s.groups.length, locked: undefined }
  expect(positionOf({ ...base, live: [] })).toBeUndefined()
  expect(positionOf({ ...base, live: [live(0, 1)] })).toBeUndefined()
})
