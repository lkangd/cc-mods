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

/* CT-TURN-001: every User input opens a group, whatever its form; what the
   person did not type joins the group before it. */

test('slash commands, local commands and ! shell commands each open a group, shown as typed', () => {
  const t = transcript()
  const prompt = t.prompt('CT-SYN plain')
  const promptCommand = t.command('review', 'src/a.ts  --quick')
  const localUser = t.command('model', '', 'local')
  const localSystem = t.localCommand('tui', '')
  const bang = t.bash('echo CT-SYN')

  const { groups } = tocModel(t.jsonl())

  expect(groups.map(g => [g.openerUuid, g.userText])).toEqual([
    [prompt, 'CT-SYN plain'],
    [promptCommand, '/review src/a.ts --quick'],
    [localUser, '/model'],
    [localSystem, '/tui'],
    [bang, '!echo CT-SYN'],
  ])
})

test('command output, shell output, interruptions, notifications, summaries and hook rows join the group before them', () => {
  const t = transcript()
  const local = t.localCommand('tui', '')
  const localOut = t.localOutput('CT-SYN renderer: fullscreen')
  const caveat = t.row({ type: 'user', isMeta: true, message: { role: 'user', content: '<local-command-caveat>Caveat: CT-SYN</local-command-caveat>' } })
  const userOut = t.row({ type: 'user', message: { role: 'user', content: '<local-command-stdout>CT-SYN</local-command-stdout>' } })
  const bang = t.bash('ls')
  const bangOut = t.bashOutput('CT-SYN listing')
  const prompt = t.prompt('CT-SYN work')
  const stopped = t.interrupt()
  const note = t.row({ type: 'user', origin: { kind: 'task-notification' }, promptSource: 'system', message: { role: 'user', content: '<task-notification>CT-SYN</task-notification>' } })
  const summary = t.row({ type: 'user', isCompactSummary: true, message: { role: 'user', content: 'CT-SYN summary <command-name>/x</command-name>' } })
  const hook = t.row({ type: 'user', isMeta: true, origin: { kind: 'human' }, message: { role: 'user', content: [{ type: 'text', text: 'CT-SYN hook' }] } })
  const peer = t.row({ type: 'user', isMeta: true, origin: { kind: 'peer' }, message: { role: 'user', content: 'CT-SYN peer' } })

  const { groups } = tocModel(t.jsonl())

  expect(groups.map(g => g.rowUuids)).toEqual([
    [local, localOut, caveat, userOut],
    [bang, bangOut],
    [prompt, stopped, note, summary, hook, peer],
  ])
})

test('a queued prompt and a prompt from an accepted suggestion each open a group', () => {
  const t = transcript()
  t.prompt('CT-SYN typed')
  t.prompt('CT-SYN queued', { promptSource: 'queued' })
  t.prompt('CT-SYN suggested', { promptSource: 'suggestion_accepted' })

  expect(tocModel(t.jsonl()).groups.map(g => g.userText)).toEqual(['CT-SYN typed', 'CT-SYN queued', 'CT-SYN suggested'])
})

/* What the TOC shows of a User input. */

test('pasted-content tags, code blocks, images and Markdown marks are left out', () => {
  const t = transcript()
  t.prompt('# CT-SYN title\n> quoted **bold** and _em_ `code` [link](http://x.test)\n- item one\n```ts\nconst x = 1\n```\n![shot](a.png) [Image #2] snake_case a*b')
  t.prompt('before <pasted_content id="ab12">CT-SYN pasted</pasted_content id="ab12"> after')

  expect(tocModel(t.jsonl()).groups.map(g => g.userText)).toEqual([
    'CT-SYN title quoted bold and em code link item one snake_case a*b',
    'before CT-SYN pasted after',
  ])
})

test('stars that do not wrap words, as in file patterns, are kept', () => {
  const t = transcript()
  t.prompt('match *.md、*.txt and *.json, not *emphasis*')

  expect(tocModel(t.jsonl()).groups[0]?.userText).toBe('match *.md、*.txt and *.json, not emphasis')
})

test('a prompt of only images says so', () => {
  const t = transcript()
  const image = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: '' } }
  t.prompt('', { message: { role: 'user', content: [image] } })
  t.prompt('', { message: { role: 'user', content: [{ type: 'text', text: '[Image #1] ' }, image] } })

  expect(tocModel(t.jsonl()).groups.map(g => g.userText)).toEqual(['（只有图片）', '（只有图片）'])
})

test('a prompt that is nothing but a code block still shows its code', () => {
  const t = transcript()
  t.prompt('```\nCT-SYN only code\n```')

  expect(tocModel(t.jsonl()).groups[0]?.userText).toBe('CT-SYN only code')
})
