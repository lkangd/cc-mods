import { expect, test } from 'claude-code/testing'
import { tocModel } from '../hooks/model'
import { transcript } from './fixture'
import type { Row } from './fixture'

/* The Agent reply of a Turn group: the steps the main agent took (its tool
   calls), the last text it wrote after its last tool call, and how the turn
   ended, all read from the transcript (CT-TURN-004, CT-DATA-005). */

const tool = (id: string, name = 'Bash'): Row => ({ type: 'tool_use', id, name, input: {} })
const text = (t: string): Row => ({ type: 'text', text: t })
/* One block of a reply that Claude Code wrote as rows of their own, all
   under the reply's message id. */
const part = (messageId: string, block: Row): Row => ({ type: 'assistant', message: { id: messageId, role: 'assistant', content: [block] } })

test('every tool call is a step, parallel ones each counted; thinking and text are not', () => {
  const t = transcript()
  t.prompt('CT-SYN count')
  t.reply([{ type: 'thinking', thinking: 'CT-SYN plan' }, text('CT-SYN looking'), tool('t1')])
  t.toolResult('t1')
  t.row(part('msg_par', tool('t2', 'Read')))
  t.row(part('msg_par', tool('t3', 'Read')))
  t.toolResult('t2')
  t.toolResult('t3')
  t.reply([tool('t4', 'Grep'), tool('t5', 'Grep')])
  t.reply([text('CT-SYN done')])

  expect(tocModel(t.jsonl()).groups[0]?.steps).toBe(5)
})

test('a subagent is one step, and its own rows are not part of the TOC', () => {
  const t = transcript()
  t.prompt('CT-SYN delegate')
  t.reply([tool('t1', 'Agent')])
  t.rows.push(
    { uuid: 'side-1', parentUuid: null, isSidechain: true, type: 'user', message: { role: 'user', content: 'CT-SYN sub prompt' } },
    { uuid: 'side-2', parentUuid: 'side-1', isSidechain: true, type: 'assistant', message: { id: 'msg_side', role: 'assistant', content: [tool('s1'), tool('s2'), text('CT-SYN sub text')] } },
  )
  t.toolResult('t1')
  t.reply([text('CT-SYN main text')])

  const { groups } = tocModel(t.jsonl())

  expect(groups).toHaveLength(1)
  expect(groups[0]?.steps).toBe(1)
  expect(groups[0]?.reply?.text).toBe('CT-SYN main text')
})

test('the reply is the text after the last tool call, the parts of one message joined', () => {
  const t = transcript()
  t.prompt('CT-SYN answer me')
  t.reply([text('CT-SYN before the tool'), tool('t1')])
  t.toolResult('t1')
  const first = t.row(part('msg_end', text('CT-SYN first part')))
  t.row(part('msg_end', text('CT-SYN **second** part')))

  const { groups } = tocModel(t.jsonl())

  expect(groups[0]?.reply).toEqual({ text: 'CT-SYN first part CT-SYN second part', uuid: first })
})

test('of texts from two messages after the last tool call, the last message is the reply', () => {
  const t = transcript()
  t.prompt('CT-SYN two messages')
  t.reply([text('CT-SYN earlier message')])
  const last = t.reply([text('CT-SYN later message')])

  expect(tocModel(t.jsonl()).groups[0]?.reply).toEqual({ text: 'CT-SYN later message', uuid: last })
})

test('a turn that ends on a tool call has no reply', () => {
  const t = transcript()
  t.prompt('CT-SYN tools only')
  t.reply([text('CT-SYN let me look'), tool('t1')])
  t.toolResult('t1')

  const group = tocModel(t.jsonl()).groups[0]

  expect(group?.reply).toBeUndefined()
  expect(group?.steps).toBe(1)
  expect(group?.ending).toBe('done')
})

test('a turn the person interrupted ends interrupted', () => {
  const t = transcript()
  t.prompt('CT-SYN stop me')
  t.reply([tool('t1')])
  t.interrupt(true)

  expect(tocModel(t.jsonl()).groups[0]?.ending).toBe('interrupted')
})

test('a turn whose last reply is an API error ends in error; an error retried away does not', () => {
  const t = transcript()
  t.prompt('CT-SYN fails')
  t.reply([tool('t1')])
  t.toolResult('t1')
  t.reply([text('API Error: CT-SYN overloaded')], { isApiErrorMessage: true })
  t.prompt('CT-SYN recovers')
  t.reply([text('API Error: CT-SYN overloaded')], { isApiErrorMessage: true })
  t.reply([text('CT-SYN fine after all')])

  expect(tocModel(t.jsonl()).groups.map(g => g.ending)).toEqual(['error', 'done'])
})

test('a local command, and a shell command the agent did no work on, have no Agent reply', () => {
  const t = transcript()
  t.localCommand('tui', '')
  t.localOutput('CT-SYN fullscreen')
  t.command('model', '', 'local')
  t.bash('echo CT-SYN')
  t.bashOutput('CT-SYN')
  t.bash('make CT-SYN')
  t.row({ type: 'user', origin: { kind: 'task-notification' }, message: { role: 'user', content: '<task-notification>CT-SYN</task-notification>' } })
  t.reply([text('CT-SYN the build finished')])
  t.command('review', '')
  t.reply([text('CT-SYN reviewed')])
  t.prompt('CT-SYN stopped before any answer')
  t.interrupt()

  expect(tocModel(t.jsonl()).groups.map(g => [g.userText, g.hasAgentReply])).toEqual([
    ['/tui', false],
    ['/model', false],
    ['!echo CT-SYN', false],
    ['!make CT-SYN', true],
    ['/review', true],
    ['CT-SYN stopped before any answer', true],
  ])
})

test('a User input the file holds nothing after yet has no Agent reply to show', () => {
  const t = transcript()
  t.prompt('CT-SYN just sent')

  expect(tocModel(t.jsonl()).groups[0]?.hasAgentReply).toBe(false)
})
