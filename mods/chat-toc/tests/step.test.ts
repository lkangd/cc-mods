import { expect, test } from 'claude-code/testing'
import { listedGroups, stepFrom } from '../hooks/step'

/* The previous and next Turn group (spec §6): which group a press of ‹ or ›
   jumps to, from the Current position over the groups the list shows. */

const all = () => true

test('a step goes to the shown group before or after the Current position', () => {
  expect(stepFrom([0, 1, 2, 3], 2, 'previous', all)).toEqual({ kind: 'jump', group: 1 })
  expect(stepFrom([0, 1, 2, 3], 2, 'next', all)).toEqual({ kind: 'jump', group: 3 })
})

test('it walks only the groups shown, from a position the list does not show', () => {
  expect(stepFrom([0, 3, 7], 5, 'previous', all)).toEqual({ kind: 'jump', group: 3 })
  expect(stepFrom([0, 3, 7], 5, 'next', all)).toEqual({ kind: 'jump', group: 7 })
  expect(stepFrom([0, 3, 7], 3, 'next', all)).toEqual({ kind: 'jump', group: 7 })
})

test('at either end nothing happens', () => {
  expect(stepFrom([0, 1, 2], 0, 'previous', all)).toEqual({ kind: 'end' })
  expect(stepFrom([0, 1, 2], 2, 'next', all)).toEqual({ kind: 'end' })
  expect(stepFrom([4, 6], 2, 'previous', all)).toEqual({ kind: 'end' })
  expect(stepFrom([], 2, 'next', all)).toEqual({ kind: 'end' })
})

test('a group without a Jump target is skipped for the next one that way that has one', () => {
  const jumpable = (g: number) => g !== 2 && g !== 3
  expect(stepFrom([0, 1, 2, 3, 4], 1, 'next', jumpable)).toEqual({ kind: 'jump', group: 4 })
  expect(stepFrom([0, 1, 2, 3, 4], 4, 'previous', jumpable)).toEqual({ kind: 'jump', group: 1 })
})

test('with groups that way but none with a Jump target, the step says so', () => {
  const jumpable = (g: number) => g < 2
  expect(stepFrom([0, 1, 2, 3], 1, 'next', jumpable)).toEqual({ kind: 'unjumpable' })
})

test('with no Current position, previous starts from the newest shown group and next does nothing', () => {
  expect(stepFrom([0, 1, 2], undefined, 'previous', all)).toEqual({ kind: 'jump', group: 2 })
  expect(stepFrom([0, 1, 2], undefined, 'next', all)).toEqual({ kind: 'end' })
})

test('the groups the list shows: every group under All and User, those with an Agent side under Agent', () => {
  const groups = [{ hasAgentReply: true }, { hasAgentReply: false }, { hasAgentReply: true }, { hasAgentReply: false }]
  expect(listedGroups(groups, 'all', undefined, undefined)).toEqual([0, 1, 2, 3])
  expect(listedGroups(groups, 'user', undefined, undefined)).toEqual([0, 1, 2, 3])
  expect(listedGroups(groups, 'agent', undefined, undefined)).toEqual([0, 2])
  /* A running last group shows its Agent side before any reply. */
  expect(listedGroups(groups, 'agent', 3, undefined)).toEqual([0, 2, 3])
})

test('during a search, only the matches the View filter lists', () => {
  const groups = [{ hasAgentReply: true }, { hasAgentReply: false }, { hasAgentReply: true }]
  expect(listedGroups(groups, 'all', undefined, [1, 2])).toEqual([1, 2])
  expect(listedGroups(groups, 'agent', undefined, [1, 2])).toEqual([2])
})
