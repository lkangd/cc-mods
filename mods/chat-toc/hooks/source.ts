/* Reading the transcript file. A new session has no file until its first
   message is written; that is the normal empty state, not a failure.

   The first read of a file no larger than `$.fs.read` takes whole reads it
   whole. Every other read (a larger file, or the rows appended since the
   last read) goes from a byte offset a chunk at a time through
   `$.process.run`: `dd` to seek and `head` to read on macOS and Linux,
   Windows PowerShell 5.1's `[IO.File]` with base64 output on Windows. Each
   chunk is cut back to its last newline and the offset moves by the UTF-8
   bytes of the lines kept, so a line cut by a chunk boundary is read whole
   by the next chunk. A line longer than a chunk is counted as unreadable and
   skipped. The calls on `$` are `readSource` in register.tsx. */

/* The largest file `$.fs.read` takes whole. */
export const WHOLE_READ_LIMIT = 4 * 1024 * 1024

/* One chunk read through `$.process.run`. */
export const CHUNK_BYTES = 4_000_000

/* On Windows the chunk comes back as base64, a third larger, and
   `$.process.run` keeps 4 MiB of output: 3,000,000 B is 4,000,000 B of
   base64. */
export const WINDOWS_CHUNK_BYTES = 3_000_000

/* How far the file has been read. */
export type ReadCursor = {
  /* The byte just after the last whole line read. */
  offset: number
  /* Whether the offset is inside a line longer than a chunk, which is being
     skipped up to its end. */
  isSkipping: boolean
}

export function readCursor(): ReadCursor {
  return { offset: 0, isSkipping: false }
}

/* The UTF-8 bytes of text decoded from UTF-8. */
export function utf8Bytes(text: string): number {
  let n = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const d = text.charCodeAt(i + 1)
      if (d >= 0xdc00 && d <= 0xdfff) {
        n += 4
        i++
      } else n += 3
    } else n += 3
  }
  return n
}

/* The part of a chunk sure to be whole characters: a character cut at the
   chunk's end decodes as U+FFFD (or not at all), so whatever trails after
   the last other character is left to be read again from its first byte. */
function wholeCharsOf(text: string): string {
  let end = text.length
  while (end > 0 && text.charCodeAt(end - 1) === 0xfffd) end--
  return text.slice(0, end)
}

type Take = {
  /* The whole lines the chunk gave, newlines included. */
  lines: string
  /* Bytes to move the offset by. */
  advance: number
  /* Lines longer than a chunk that ended in this chunk. */
  overlong: number
}

/* What one chunk read at `cursor.offset` gives; `isFull` is whether the file
   held a whole chunk's bytes there (so a chunk with no newline is a line
   longer than a chunk, not the file's half-written last line). Moves the
   cursor. */
function take(cursor: ReadCursor, text: string, isFull: boolean): Take {
  let advance = 0
  let overlong = 0
  let rest = text
  if (cursor.isSkipping) {
    const end = rest.indexOf('\n')
    if (end < 0) {
      /* Still inside the long line: move on, or wait for its end. */
      if (isFull) advance = utf8Bytes(wholeCharsOf(rest))
      cursor.offset += advance
      return { lines: '', advance, overlong }
    }
    advance += utf8Bytes(rest.slice(0, end + 1))
    overlong += 1
    cursor.isSkipping = false
    rest = rest.slice(end + 1)
  }
  const cut = rest.lastIndexOf('\n')
  let lines = ''
  if (cut >= 0) {
    lines = rest.slice(0, cut + 1)
    advance += utf8Bytes(lines)
  } else if (isFull && advance === 0) {
    /* No newline in a whole chunk: a line longer than a chunk. */
    cursor.isSkipping = true
    advance = utf8Bytes(wholeCharsOf(rest))
  }
  cursor.offset += advance
  return { lines, advance, overlong }
}

export type Chunks = {
  /* The whole lines read, chunk by chunk, newlines included. */
  lines: string[]
  /* Lines longer than a chunk, skipped. */
  overlong: number
}

/* Reads from `cursor.offset` to `size`, a chunk of `chunkBytes` at a time,
   `readChunk` handing over the decoded text of `bytes` bytes at `offset`.
   Stops at the file's half-written last line, if any. */
export async function readChunks(
  cursor: ReadCursor,
  size: number,
  chunkBytes: number,
  readChunk: (offset: number, bytes: number) => Promise<string>,
): Promise<Chunks> {
  const out: Chunks = { lines: [], overlong: 0 }
  while (cursor.offset < size) {
    const isFull = cursor.offset + chunkBytes <= size
    const got = take(cursor, await readChunk(cursor.offset, chunkBytes), isFull)
    if (got.lines) out.lines.push(got.lines)
    out.overlong += got.overlong
    if (!isFull || got.advance === 0) break
  }
  return out
}

/* The whole lines of a file read whole, from the start. */
export function takeWhole(cursor: ReadCursor, text: string): Chunks {
  const got = take(cursor, text, false)
  return { lines: got.lines ? [got.lines] : [], overlong: got.overlong }
}

/* A Windows path: a drive letter or a UNC share. */
export function isWindowsPath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\')
}

export function chunkBytesFor(path: string): number {
  return isWindowsPath(path) ? WINDOWS_CHUNK_BYTES : CHUNK_BYTES
}

export type ChunkCommand = { argv: string[]; env?: Record<string, string> }

/* `dd` only seeks a seekable input, and `head` reads on from the same file
   descriptor (`tail -c +N` is slow on macOS). The values go in as
   arguments, never into the script. */
const POSIX_SCRIPT = '{ dd bs=1 skip="$1" count=0 2>/dev/null; head -c "$3"; } < "$2"'

/* Windows PowerShell 5.1, which every Windows has. The values go in through
   the environment, so no path needs quoting; the file is opened sharing
   writes, as Claude Code keeps appending to it. */
const WINDOWS_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  '$f=[IO.File]::Open($env:CHAT_TOC_PATH,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)',
  'try{',
  '[void]$f.Seek([int64]$env:CHAT_TOC_OFFSET,[IO.SeekOrigin]::Begin)',
  '$n=[int]$env:CHAT_TOC_BYTES;$b=New-Object byte[] $n;$t=0',
  'while($t -lt $n){$r=$f.Read($b,$t,$n-$t);if($r -le 0){break};$t+=$r}',
  '[Console]::Out.Write([Convert]::ToBase64String($b,0,$t))',
  '}finally{$f.Dispose()}',
].join(';')

export function chunkCommand(path: string, offset: number): ChunkCommand {
  const bytes = chunkBytesFor(path)
  if (isWindowsPath(path)) {
    return {
      argv: ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_SCRIPT],
      env: { CHAT_TOC_PATH: path, CHAT_TOC_OFFSET: String(offset), CHAT_TOC_BYTES: String(bytes) },
    }
  }
  return { argv: ['sh', '-c', POSIX_SCRIPT, 'sh', String(offset), path, String(bytes)] }
}

/* The chunk's text from what the command wrote. */
export function chunkText(path: string, stdout: string): string {
  if (!isWindowsPath(path)) return stdout
  const binary = atob(stdout.trim())
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

export type SourceRead =
  /* The file does not exist yet. */
  | { kind: 'missing' }
  /* The file is the size it was at the last read: nothing new to read. */
  | { kind: 'unchanged' }
  /* The whole lines read from a file of `size` bytes; `isFromStart` when the
     reading starts over. */
  | { kind: 'lines'; chunks: Chunks; isFromStart: boolean; size: number }
  | { kind: 'failed'; reason: FailReason }

export type FailReason = 'denied' | 'error'

/* Why a read failed, from what the host threw or the command wrote. */
export function failReasonOf(error: unknown): FailReason {
  const text = error instanceof Error ? error.message : String(error)
  return /EACCES|EPERM|permission|denied|UnauthorizedAccess/i.test(text) ? 'denied' : 'error'
}
