import { expect, test } from 'claude-code/testing'
import { wrapCells } from '../hooks/cells'

/* How a side's text folds into the pane's lines: no line opens with
   closing punctuation, and a short Latin word or path moves down whole. */

test('closing punctuation never opens a line: the character before it moves down with it', () => {
  expect(wrapCells('一二三四，五六', 8, 2)).toEqual(['一二三', '四，五六'])
  expect(wrapCells('一二三四。', 8, 2)).toEqual(['一二三', '四。'])
})

test('a short Latin word or path moves down whole, and a fold at a space keeps the space off both lines', () => {
  expect(wrapCells('看下 regroup.ts 哪里', 10, 3)).toEqual(['看下', 'regroup.ts', '哪里'])
  expect(wrapCells('改好了cells.ts', 10, 2)).toEqual(['改好了', 'cells.ts'])
})

test('a word longer than a line is cut where the line ends', () => {
  expect(wrapCells('ab rewind_regroup.test.ts', 10, 3)).toEqual(['ab rewind_', 'regroup.te', 'st.ts'])
})
