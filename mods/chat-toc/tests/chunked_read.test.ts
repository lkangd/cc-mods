import { expect, test } from 'claude-code/testing'
import { readChunks, readCursor } from '../hooks/source'
import type { ReadCursor } from '../hooks/source'

/* The transcript read a chunk at a time from a byte offset: each chunk is
   cut back to its last newline and the offset moves by the bytes kept, so
   what is read is the file's whole lines, exactly once, wherever the chunk
   boundaries fall. A line longer than a chunk is counted and skipped. */

type File = { bytes: Uint8Array }

function file(text: string): File {
  return { bytes: new TextEncoder().encode(text) }
}

/* A chunk as the host hands it over: the bytes decoded as UTF-8, a
   character cut at the end decoded as a replacement character. */
function chunkOf(f: File) {
  const reads: number[] = []
  const read = async (offset: number, bytes: number) => {
    reads.push(offset)
    return new TextDecoder().decode(f.bytes.slice(offset, offset + bytes))
  }
  return { read, reads }
}

async function readAll(f: File, cursor: ReadCursor, chunk: number) {
  const { read, reads } = chunkOf(f)
  const got = await readChunks(cursor, f.bytes.length, chunk, read)
  return { text: got.lines.join(''), overlong: got.overlong, reads }
}

const LINES = ['{"a":"plain"}', '{"b":"中文跨块的一行"}', '{"c":"emoji 🙂🙂 here"}', '{"d":"x"}', '{"e":"末行"}']
const TEXT = LINES.map(l => l + '\n').join('')

test('every chunk size reads the same whole lines as the file holds, half lines and half characters included', async () => {
  /* The longest line is 30 bytes: every chunk here holds a whole line. */
  for (let chunk = 31; chunk <= 80; chunk++) {
    const cursor = readCursor()
    const got = await readAll(file(TEXT), cursor, chunk)
    expect(got.text).toBe(TEXT)
    expect(got.overlong).toBe(0)
    expect(cursor.offset).toBe(file(TEXT).bytes.length)
  }
})

test('chunks start where the previous one kept its last newline', async () => {
  const cursor = readCursor()
  const got = await readAll(file('{"a":1}\n{"b":2}\n{"c":3}\n'), cursor, 12)

  expect(got.reads).toEqual([0, 8, 16])
})

test('a half-written last line is left for the next read and read whole once it ends', async () => {
  const cursor = readCursor()
  const first = await readAll(file('{"a":1}\n{"b":"写到一半'), cursor, 64)
  expect(first.text).toBe('{"a":1}\n')
  expect(cursor.offset).toBe(8)

  const second = await readAll(file('{"a":1}\n{"b":"写到一半写完了"}\n{"c":3}\n'), cursor, 64)
  expect(second.text).toBe('{"b":"写到一半写完了"}\n{"c":3}\n')
})

test('a line longer than a chunk is counted once and skipped, and the lines after it are read', async () => {
  const long = '{"long":"' + '长'.repeat(40) + 'ascii tail' + '字'.repeat(30) + '"}'
  const text = '{"a":1}\n' + long + '\n{"b":2}\n'
  for (const chunk of [16, 17, 33, 50]) {
    const cursor = readCursor()
    const got = await readAll(file(text), cursor, chunk)
    expect(got.text).toBe('{"a":1}\n{"b":2}\n')
    expect(got.overlong).toBe(1)
    expect(cursor.offset).toBe(file(text).bytes.length)
  }
})

test('a line longer than a chunk still being written is counted once, when it ends', async () => {
  const head = '{"a":1}\n{"long":"' + 'x'.repeat(50)
  const cursor = readCursor()
  const first = await readAll(file(head), cursor, 16)
  expect(first.overlong).toBe(0)

  const second = await readAll(file(head + 'y'.repeat(20)), cursor, 16)
  expect(second.overlong).toBe(0)

  const third = await readAll(file(head + 'y'.repeat(20) + '"}\n{"b":2}\n'), cursor, 16)
  expect(third.overlong).toBe(1)
  expect(first.text + second.text + third.text).toBe('{"a":1}\n{"b":2}\n')
})
