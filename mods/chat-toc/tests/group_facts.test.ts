import { expect, test } from 'claude-code/testing'
import { tocModel } from '../hooks/model'
import { setLanguage } from '../hooks/text'
import { transcript } from './fixture'

/* The facts each Turn group carries for the preview, search and reuse
   (spec §4), read through the whole-file model. */

const factsOf = (jsonl: string) => tocModel(jsonl).groups.map(g => g.facts)

test('a prompt keeps its text as typed: code blocks, Markdown and pasted content stay, the paste tags go', () => {
  setLanguage('en')
  const t = transcript()
  t.prompt('look at **this**:\n\n```ts\nconst a = 1\n```\n<pasted_content id="ab12">CT-SYN pasted\nline two</pasted_content id="ab12"> after')
  expect(factsOf(t.jsonl())[0]?.input).toBe('look at **this**:\n\n```ts\nconst a = 1\n```\nCT-SYN pasted\nline two after')
  expect(factsOf(t.jsonl())[0]?.hasImages).toBe(false)
})

test('a slash command reads as /name args, a shell command as !cmd, both with their own spacing', () => {
  const t = transcript()
  t.command('review', 'src/a.ts   --quick')
  t.localCommand('model', '')
  t.bash('ls -la\necho two')
  expect(factsOf(t.jsonl()).map(f => f?.input)).toEqual(['/review src/a.ts   --quick', '/model', '!ls -la\necho two'])
})

test('an image-only prompt reads as empty and a prompt with images says it held them', () => {
  setLanguage('en')
  const t = transcript()
  const image = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }
  t.prompt('', { message: { role: 'user', content: [image] } })
  t.prompt('', { message: { role: 'user', content: [{ type: 'text', text: 'CT-SYN see [Image #1]' }, image] } })
  const facts = factsOf(t.jsonl())
  expect(facts.map(f => [f?.input, f?.hasImages])).toEqual([
    ['', true],
    ['CT-SYN see', true],
  ])
})

const use = (id: string, name: string, input: Record<string, unknown>) => ({ type: 'tool_use', id, name, input })

test('files changed by Edit, Write and a Bash diff, and read by Read only; a file both read and changed counts as changed', () => {
  const t = transcript()
  t.prompt('CT-SYN touch files')
  t.reply([use('t1', 'Read', { file_path: '/p/a.ts' }), use('t2', 'Read', { file_path: '/p/b.ts' })])
  t.toolResult('t1')
  t.reply([use('t3', 'Edit', { file_path: '/p/a.ts', old_string: 'x', new_string: 'y' }), use('t4', 'Write', { file_path: '/p/c.ts', content: '' })])
  t.reply([use('t5', 'Bash', { command: 'sed -i s/a/b/ /p/d.ts' }), use('t6', 'Glob', { pattern: '*', path: '/p' }), use('t7', 'Grep', { pattern: 'x', path: '/p/e' })])
  t.row({
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't5', content: '' }] },
    toolUseResult: { stdout: '', bashEditDiff: { changedFiles: ['/p/d.ts', '/p/c.ts'], files: [] } },
  })
  t.row({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't8', content: '' }] }, toolUseResult: { bashEditDiff: { changedFiles: null } } })
  const facts = factsOf(t.jsonl())[0]
  expect(facts?.changed).toEqual(['/p/a.ts', '/p/c.ts', '/p/d.ts'])
  expect(facts?.read).toEqual(['/p/b.ts'])
})

test("the duration is the sum of the group's turn_duration rows, and absent without one", () => {
  const t = transcript()
  t.prompt('CT-SYN timed')
  t.reply([{ type: 'text', text: 'one' }])
  t.row({ type: 'system', subtype: 'turn_duration', durationMs: 4_000, messageCount: 2, isMeta: false })
  t.row({ type: 'user', origin: { kind: 'task-notification' }, message: { role: 'user', content: '<task-notification>done</task-notification>' } })
  t.reply([{ type: 'text', text: 'two' }])
  t.row({ type: 'system', subtype: 'turn_duration', durationMs: 1_500, messageCount: 2, isMeta: false })
  t.prompt('CT-SYN untimed')
  t.reply([{ type: 'text', text: 'three' }])
  expect(factsOf(t.jsonl()).map(f => f?.durationMs)).toEqual([5_500, undefined])
})

test('output tokens count each message.id once, and are absent when no row states usage', () => {
  const t = transcript()
  const usage = (output_tokens: number) => ({ input_tokens: 3, output_tokens, cache_read_input_tokens: 90_000 })
  const streamed = (id: string, content: unknown[], tokens: number) =>
    t.row({ type: 'assistant', message: { id, role: 'assistant', content, usage: usage(tokens) } })
  t.prompt('CT-SYN counted')
  streamed('msg_a', [{ type: 'text', text: 'first block' }], 1_200)
  streamed('msg_a', [use('t1', 'Bash', { command: 'ls' })], 1_200)
  t.toolResult('t1')
  streamed('msg_b', [{ type: 'text', text: 'done' }], 300)
  t.prompt('CT-SYN uncounted')
  t.reply([{ type: 'text', text: 'no usage here' }])
  expect(factsOf(t.jsonl()).map(f => f?.outputTokens)).toEqual([1_500, undefined])
})

test("the last text is the reply's Markdown source; the latest text is what was written last, tool calls after it or not", () => {
  const t = transcript()
  t.prompt('CT-SYN markdown')
  t.reply([{ type: 'text', text: 'Looking **first**.' }, use('t1', 'Read', { file_path: '/p/a.ts' })])
  t.toolResult('t1')
  t.row({ type: 'assistant', message: { id: 'msg_z', role: 'assistant', content: [{ type: 'text', text: '## Done\n\n- one' }] } })
  t.row({ type: 'assistant', message: { id: 'msg_z', role: 'assistant', content: [{ type: 'text', text: '- `two`' }] } })
  t.prompt('CT-SYN still working')
  t.reply([{ type: 'text', text: 'Reading *now*.' }, use('t2', 'Read', { file_path: '/p/b.ts' })])
  const facts = factsOf(t.jsonl())
  expect([facts[0]?.lastText, facts[0]?.latestText]).toEqual(['## Done\n\n- one\n- `two`', '## Done\n\n- one\n- `two`'])
  expect([facts[1]?.lastText, facts[1]?.latestText]).toEqual([undefined, 'Reading *now*.'])
})
