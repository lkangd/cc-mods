import { expect, test } from 'claude-code/testing'
import { tocModel } from '../hooks/model'
import { transcript } from './fixture'

/* The Chat TOC lists one Turn group per User input on the current branch,
   in transcript order. */

test('each typed prompt opens its own turn group, in order', () => {
  const t = transcript()
  const first = t.prompt('CT-SYN alpha question')
  t.reply([{ type: 'text', text: 'alpha answer' }])
  const second = t.prompt('CT-SYN beta question')
  t.reply([{ type: 'text', text: 'beta answer' }])

  const { groups } = tocModel(t.jsonl())

  expect(groups.map(g => [g.openerUuid, g.userText])).toEqual([
    [first, 'CT-SYN alpha question'],
    [second, 'CT-SYN beta question'],
  ])
})

test('the same prompt submitted twice is two turn groups', () => {
  const t = transcript()
  t.prompt('CT-SYN again')
  t.prompt('CT-SYN again')

  expect(tocModel(t.jsonl()).groups.map(g => g.userText)).toEqual(['CT-SYN again', 'CT-SYN again'])
})

test('tool results, injected reminders and rows nobody typed join the turn group before them', () => {
  const t = transcript()
  const opener = t.prompt('CT-SYN run the tool')
  const call = t.reply([{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: {} }])
  const result = t.toolResult('toolu_1')
  const reminder = t.row({ type: 'user', isMeta: true, message: { role: 'user', content: 'reminder' } })
  const notice = t.row({ type: 'user', origin: { kind: 'task-notification' }, message: { role: 'user', content: 'task done' } })
  const reply = t.reply([{ type: 'text', text: 'done' }])

  const { groups } = tocModel(t.jsonl())

  expect(groups).toHaveLength(1)
  expect(groups[0]?.rowUuids).toEqual([opener, call, result, reminder, notice, reply])
})

test('a branch the conversation was rewound away from is not listed', () => {
  const t = transcript()
  const kept = t.prompt('CT-SYN kept')
  const keptReply = t.reply([{ type: 'text', text: 'kept answer' }])
  t.prompt('CT-SYN abandoned')
  t.reply([{ type: 'text', text: 'abandoned answer' }])
  t.rewindTo(keptReply)
  t.prompt('CT-SYN new branch')

  const { groups } = tocModel(t.jsonl())

  expect(groups.map(g => g.userText)).toEqual(['CT-SYN kept', 'CT-SYN new branch'])
  expect(groups[0]?.openerUuid).toBe(kept)
})

test('a subagent sidechain is not part of the transcript', () => {
  const t = transcript()
  t.prompt('CT-SYN main')
  t.rows.push({ uuid: 'side-1', parentUuid: null, isSidechain: true, type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: 'side prompt' } })

  expect(tocModel(t.jsonl()).groups.map(g => g.userText)).toEqual(['CT-SYN main'])
})

test('lines that are not rows are counted, and the rest still read', () => {
  const t = transcript()
  t.prompt('CT-SYN fine')

  const model = tocModel(t.jsonl() + '{not json\n[1,2]\n')

  expect(model.unreadable).toBe(2)
  expect(model.groups.map(g => g.userText)).toEqual(['CT-SYN fine'])
})

test('a prompt split over lines is listed with its whitespace collapsed', () => {
  const t = transcript()
  t.prompt('  CT-SYN first line\n\n  second   line  ')

  expect(tocModel(t.jsonl()).groups[0]?.userText).toBe('CT-SYN first line second line')
})
