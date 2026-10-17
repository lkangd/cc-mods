import { expect, test } from 'claude-code/testing'
import { currentChain } from '../hooks/chain'
import { groupTurns } from '../hooks/groups'
import { isUnscrollable, jumpTargetsOf } from '../hooks/jump'
import { newSites, noteSite, rowIndex } from '../hooks/sites'
import type { Sites } from '../hooks/sites'
import { parseTranscript } from '../hooks/transcript'
import { transcript } from './fixture'
import type { Builder, Row } from './fixture'

/* Where a press on each side of an entry scrolls the transcript, in the
   order tried: up to three rows, the next tried when the host refuses one. */

const text = (s: string): Row => ({ type: 'text', text: s })
const tool = (id: string): Row => ({ type: 'tool_use', id, name: 'Bash', input: {} })

function targets(t: Builder, group: number, side: 'user' | 'agent', sites: Sites = newSites()) {
  const chain = currentChain(parseTranscript(t.jsonl()).rows)
  const rows = rowIndex(chain)
  const g = groupTurns(chain)[group]
  if (!g) throw new Error(`no group ${group}`)
  return jumpTargetsOf(g, side, rows, sites).map(x => [x.requestId, x.block])
}

test('a prompt jumps to its own row, its top at the top of the view', () => {
  const t = transcript()
  const asked = t.prompt('CT-SYN hello')
  t.reply([text('CT-SYN hi')])

  expect(targets(t, 0, 'user')).toEqual([[asked, 'start']])
})

test('an Agent reply jumps to the row its last text starts on', () => {
  const t = transcript()
  t.prompt('CT-SYN fix it')
  t.reply([tool('t1')])
  t.toolResult('t1')
  const first = t.reply([text('CT-SYN fixed')], { message: { id: 'msg_end', role: 'assistant', content: [text('CT-SYN fixed')] } })
  t.reply([text('CT-SYN and checked')], { message: { id: 'msg_end', role: 'assistant', content: [text('CT-SYN and checked')] } })

  expect(targets(t, 0, 'agent')).toEqual([[first, 'start']])
})

test('a reply without text jumps to the turn\'s last tool rows, by their call ids, latest first', () => {
  const t = transcript()
  t.prompt('CT-SYN tools only')
  for (const id of ['t1', 't2', 't3', 't4']) {
    t.reply([tool(id)])
    t.toolResult(id)
  }

  expect(targets(t, 0, 'agent')).toEqual([
    ['t4', 'start'],
    ['t3', 'start'],
    ['t2', 'start'],
  ])
})

test('a tool row the host drew is jumped to under the id it drew it under', () => {
  const t = transcript()
  t.prompt('CT-SYN tools only')
  const calls = t.reply([tool('t1')])
  t.toolResult('t1')
  const chain = currentChain(parseTranscript(t.jsonl()).rows)
  const sites = newSites()
  noteSite(sites, rowIndex(chain), 'ToolGroup', `collapsed-${calls}`, undefined)

  expect(targets(t, 0, 'agent', sites)).toEqual([[`collapsed-${calls}`, 'start']])
})

test('a turn interrupted before the agent wrote anything has nowhere to jump', () => {
  const t = transcript()
  t.prompt('CT-SYN stop')
  t.interrupt()

  expect(targets(t, 0, 'agent')).toEqual([])
})

test('a local command jumps to its output, centred, then to the rows after it', () => {
  const t = transcript()
  t.localCommand('tui', '')
  const output = t.localOutput('Current renderer: fullscreen')
  const next = t.prompt('CT-SYN next')
  const answer = t.reply([text('CT-SYN answer')])

  expect(targets(t, 0, 'user')).toEqual([
    [output, 'center'],
    [next, 'center'],
    [answer, 'center'],
  ])
})

test('a prompt-type command jumps to the first row the agent drew for it, a tool row included', () => {
  const t = transcript()
  t.command('review', 'src/a.ts')
  t.reply([tool('t1')])
  t.toolResult('t1')
  const answer = t.reply([text('CT-SYN reviewed')])

  expect(targets(t, 0, 'user')).toEqual([
    ['t1', 'center'],
    [answer, 'center'],
  ])
})

test('a shell command with nothing drawable after it jumps to the rows before it, nearest first', () => {
  const t = transcript()
  const asked = t.prompt('CT-SYN first')
  const answer = t.reply([text('CT-SYN answer')])
  t.bash('echo hi')
  t.bashOutput('hi')

  expect(targets(t, 1, 'user')).toEqual([
    [answer, 'center'],
    [asked, 'center'],
  ])
})

test('empty command output is skipped, but any row the host drew counts', () => {
  const t = transcript()
  t.localCommand('tui', '')
  const empty = t.localOutput('')
  t.bash('true')
  const quiet = t.bashOutput('')
  const asked = t.prompt('CT-SYN after')
  const chain = currentChain(parseTranscript(t.jsonl()).rows)

  expect(targets(t, 0, 'user')).toEqual([[asked, 'center']])

  const sites = newSites()
  noteSite(sites, rowIndex(chain), 'CommandOutput', quiet, undefined)
  expect(targets(t, 0, 'user', sites)).toEqual([
    [quiet, 'center'],
    [asked, 'center'],
  ])
  expect(empty).toBeDefined()
})

/* Claude Code Desktop answers every transcript scroll with "transcript not
   scrollable here" (2.1.295, ticket 36): no row is refused, the surface
   cannot jump at all, so it dims nothing and, since ticket 24, says
   nothing and tries no more. */
test('a surface that cannot scroll its transcript is told apart from a refused row', () => {
  expect(isUnscrollable('transcript not scrollable here')).toBe(true)
  expect(isUnscrollable('Error: transcript not scrollable here')).toBe(true)
  expect(isUnscrollable('no site draws that requestId')).toBe(false)
})
