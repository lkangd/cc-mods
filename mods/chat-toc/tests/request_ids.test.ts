import { expect, test } from 'claude-code/testing'
import { currentChain } from '../hooks/chain'
import { hostIdOf, newSites, noteSite, resolveSites, rowIndex, syncRows } from '../hooks/sites'
import { parseTranscript } from '../hooks/transcript'
import { transcript } from './fixture'

/* The host draws a transcript row under a requestId; chat-toc finds the row
   by four rules in order: the uuid itself, the uuid behind `collapsed-`, a
   tool call's id, and the uuid's first 24 characters. */

const chainOf = (text: string) => currentChain(parseTranscript(text).rows)

function session() {
  const t = transcript()
  const asked = t.prompt('CT-SYN read the files')
  const tools = t.reply([{ type: 'tool_use', id: 'toolu_01', name: 'Read', input: {} }])
  t.toolResult('toolu_01')
  const answer = t.reply([{ type: 'text', text: 'CT-SYN read' }])
  return { t, asked, tools, answer }
}

test('a message drawn under its own uuid is that row', () => {
  const { t, asked, answer } = session()
  const rows = rowIndex(chainOf(t.jsonl()))
  const sites = newSites()

  expect(noteSite(sites, rows, 'UserMessage', asked, undefined)).toBe(asked)
  expect(noteSite(sites, rows, 'AssistantMessage', answer, undefined)).toBe(answer)
})

test('a collapsed tool group is the row behind its prefix, whole or as 24 characters', () => {
  const { t, tools } = session()
  const rows = rowIndex(chainOf(t.jsonl()))
  const sites = newSites()

  expect(noteSite(sites, rows, 'ToolGroup', `collapsed-${tools}`, undefined)).toBe(tools)
  expect(noteSite(sites, rows, 'ToolGroup', `collapsed-${tools.slice(0, 24)}000000000000`, undefined)).toBe(tools)
})

test('a tool call drawn under its id is the row that made the call', () => {
  const { t, tools } = session()
  const rows = rowIndex(chainOf(t.jsonl()))

  expect(noteSite(newSites(), rows, 'ToolGroup', 'toolu_01', undefined)).toBe(tools)
})

test('one block of a split message, numbered after the first 24 characters, is that row', () => {
  const { t, answer } = session()
  const rows = rowIndex(chainOf(t.jsonl()))

  expect(noteSite(newSites(), rows, 'AssistantMessage', `${answer.slice(0, 24)}000000000001`, undefined)).toBe(answer)
})

test('the optimistic placeholder and ids of no chain row match nothing', () => {
  const { t } = session()
  const rows = rowIndex(chainOf(t.jsonl()))
  const sites = newSites()

  expect(noteSite(sites, rows, 'UserMessage', 'placeholder', undefined)).toBeUndefined()
  expect(noteSite(sites, rows, 'UserMessage', 'ffffffff-0000-4000-8000-000000000001', undefined)).toBeUndefined()
})

test('a row drawn before the file was read is matched once the read brings it', () => {
  const t = transcript()
  const asked = t.prompt('CT-SYN early')
  const sites = newSites()
  const rows = rowIndex([])

  expect(noteSite(sites, rows, 'UserMessage', asked, { first: 0, last: 2, of: 3 })).toBeUndefined()
  syncRows(rows, chainOf(t.jsonl()))
  const found = resolveSites(sites, rows)

  expect(found).toEqual([asked])
  expect(hostIdOf(sites, rows, asked)).toBe(asked)
})

test('a jump uses the id the host drew a row under, and a message id over a tool group', () => {
  const { t, tools, answer } = session()
  const rows = rowIndex(chainOf(t.jsonl()))
  const sites = newSites()
  const groupId = `collapsed-${tools.slice(0, 24)}000000000000`

  noteSite(sites, rows, 'ToolGroup', groupId, undefined)
  expect(hostIdOf(sites, rows, tools)).toBe(groupId)
  expect(hostIdOf(sites, rows, answer)).toBe(answer)
})

test('a tool row never drawn is reached by its tool call id', () => {
  const { t, tools } = session()
  const rows = rowIndex(chainOf(t.jsonl()))

  expect(hostIdOf(newSites(), rows, tools)).toBe('toolu_01')
})

test('rows read later are added without matching the chain again, and a new chain is matched afresh', () => {
  const t = transcript()
  t.prompt('CT-SYN one')
  const first = chainOf(t.jsonl())
  const rows = rowIndex(first)
  const sites = newSites()
  const later = t.prompt('CT-SYN two')
  noteSite(sites, rows, 'UserMessage', later, undefined)

  /* The chain grew in place: only the new row joins. */
  first.push(...chainOf(t.jsonl()).slice(first.length))
  expect(syncRows(rows, first)).toBe(false)
  expect(resolveSites(sites, rows)).toEqual([later])

  /* A rewind's branch is another chain: every drawn id is matched again,
     and one that left the chain no longer matches. */
  t.rewindTo(null)
  t.prompt('CT-SYN other branch')
  const isNew = syncRows(rows, chainOf(t.jsonl()))
  expect(isNew).toBe(true)
  resolveSites(sites, rows, isNew)
  expect(hostIdOf(sites, rows, later)).toBe(later)
  expect(sites.rowOf.get(later)).toBeUndefined()
})
