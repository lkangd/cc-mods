import { expect, test } from 'claude-code/testing'
import { tocModel } from '../hooks/model'
import { newReading, readLines } from '../hooks/regroup'
import { indexGroups, matchesOf, nearestMatch, newSearchIndex, queryWords } from '../hooks/search'
import { transcript } from './fixture'

/* Search's index and matcher (spec §2): the words of a query, which groups
   hold every one of them, and in which fields. */

const use = (id: string, name: string, input: Record<string, unknown>) => ({ type: 'tool_use', id, name, input })

function session() {
  const t = transcript()
  t.prompt('CT-SYN Fix the Login page')
  t.reply([{ type: 'text', text: 'The **login** form now validates.' }])
  t.prompt('CT-SYN 修改登录页面的样式')
  t.reply([use('t1', 'Edit', { file_path: '/home/synthetic/project/src/LoginPage.tsx', old_string: 'a', new_string: 'b' })])
  t.toolResult('t1')
  t.reply([{ type: 'text', text: '样式已更新' }])
  t.prompt('CT-SYN read the readme')
  t.reply([use('t2', 'Read', { file_path: '/home/synthetic/project/README.md' })])
  t.toolResult('t2')
  t.reply([{ type: 'text', text: 'It says ＦＵＬＬ width.' }])
  return t
}

const matched = (jsonl: string, query: string, filter: 'all' | 'user' | 'agent' = 'all') => {
  const groups = tocModel(jsonl).groups
  return matchesOf(newSearchIndex(), groups, queryWords(query), filter, false).map(m => m.group)
}

test('every word must be found, in any field of the group, whatever its case', () => {
  const jsonl = session().jsonl()
  expect(matched(jsonl, 'login')).toEqual([0, 1])
  expect(matched(jsonl, 'LOGIN validates')).toEqual([0])
  expect(matched(jsonl, 'login   readme')).toEqual([])
  expect(matched(jsonl, '  ')).toEqual([])
})

test('after NFKC: full-width letters and spaces match their plain forms', () => {
  const jsonl = session().jsonl()
  expect(queryWords('ｆｕｌｌ　Width')).toEqual(['full', 'width'])
  expect(matched(jsonl, 'full width')).toEqual([2])
  expect(matched(jsonl, 'ＲＥＡＤＭＥ')).toEqual([2])
})

test('CJK matches as plain substrings, without segmenting', () => {
  const jsonl = session().jsonl()
  expect(matched(jsonl, '登录')).toEqual([1])
  expect(matched(jsonl, '录页')).toEqual([1])
  expect(matched(jsonl, '样式 更新')).toEqual([1])
})

test('a path matches as a substring of its absolute form, changed or read', () => {
  const jsonl = session().jsonl()
  expect(matched(jsonl, 'src/loginpage')).toEqual([1])
  expect(matched(jsonl, '/home/synthetic/project/')).toEqual([1, 2])
  expect(matched(jsonl, 'project/readme.md')).toEqual([2])
})

test('User searches only the User input; Agent only the last text and the paths', () => {
  const jsonl = session().jsonl()
  expect(matched(jsonl, 'validates', 'user')).toEqual([])
  expect(matched(jsonl, 'login', 'user')).toEqual([0])
  expect(matched(jsonl, 'login', 'agent')).toEqual([0, 1])
  expect(matched(jsonl, 'ct-syn', 'agent')).toEqual([])
  expect(matched(jsonl, 'readme', 'agent')).toEqual([2])
})

test('a match says which fields held a word, and which paths', () => {
  const groups = tocModel(session().jsonl()).groups
  const [first, second] = matchesOf(newSearchIndex(), groups, queryWords('login'), 'all', false)
  expect(first).toEqual({ group: 0, user: true, agent: true, files: false, paths: [] })
  expect(second).toEqual({ group: 1, user: false, agent: false, files: true, paths: ['/home/synthetic/project/src/LoginPage.tsx'] })
})

test("a running group matches the text it has written so far", () => {
  const t = transcript()
  t.prompt('CT-SYN start')
  t.reply([{ type: 'text', text: 'CT-SYN looking around' }, use('t1', 'Bash', { command: 'ls' })])
  const groups = tocModel(t.jsonl()).groups
  const words = queryWords('around')
  expect(matchesOf(newSearchIndex(), groups, words, 'all', true).map(m => m.group)).toEqual([0])
  expect(matchesOf(newSearchIndex(), groups, words, 'all', false).map(m => m.group)).toEqual([])
})

test('the nearest match: at or before the position, else the first after it; the newest with no position', () => {
  expect(nearestMatch([2, 5, 9], 6)).toBe(5)
  expect(nearestMatch([2, 5, 9], 5)).toBe(5)
  expect(nearestMatch([2, 5, 9], 1)).toBe(2)
  expect(nearestMatch([2, 5, 9], undefined)).toBe(9)
  expect(nearestMatch([], 3)).toBeUndefined()
})

test('the index is built at regroup for the groups a read changed only, and agrees with a whole build', () => {
  const t = session()
  const lines = t.jsonl().split('\n').filter(Boolean)
  const reading = newReading()
  const index = newSearchIndex()
  readLines(reading, lines.slice(0, 6).join('\n') + '\n')
  expect(indexGroups(index, reading.groups)).toBe(reading.groups.length)
  readLines(reading, lines.slice(6).join('\n') + '\n')
  expect(reading.lastRegroup).toBe('tail')
  /* The read regrouped the last group it had and added the ones after. */
  expect(indexGroups(index, reading.groups)).toBe(2)
  expect(indexGroups(index, reading.groups)).toBe(0)

  const whole = tocModel(t.jsonl()).groups
  for (const query of ['login', 'readme', '样式', 'ct-syn page']) {
    for (const filter of ['all', 'user', 'agent'] as const) {
      const words = queryWords(query)
      expect(matchesOf(index, reading.groups, words, filter, false)).toEqual(matchesOf(newSearchIndex(), whole, words, filter, false))
    }
  }
})
