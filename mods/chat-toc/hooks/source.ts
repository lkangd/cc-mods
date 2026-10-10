/* What a read of the transcript file can come to. A new session has no file
   until its first message is written; that is the normal empty state, not a
   failure. The read itself is `readSource` in register.tsx, which may hold
   the host's `$`. */

/* The largest file `$.fs.read` takes whole. */
export const WHOLE_READ_LIMIT = 4 * 1024 * 1024

export type SourceRead =
  /* The file does not exist yet. */
  | { kind: 'missing' }
  /* The file is the size it was at the last read: nothing new to read. */
  | { kind: 'unchanged' }
  | { kind: 'text'; text: string; size: number }
  /* Larger than one whole read; read in chunks (not yet supported). */
  | { kind: 'too-large'; size: number }
  | { kind: 'failed' }
