/* A one-entry memo: what a drawing worked out last, kept while what it was
   worked out from is the same, so a redraw that changed none of it does
   not work it out again. Keys compare by identity (`Object.is`): a key
   that is a fresh object every drawing never matches. */

export type Memo<V> = { last: { keys: readonly unknown[]; value: V } | undefined }

export function newMemo<V>(): Memo<V> {
  return { last: undefined }
}

/* The value for `keys`: the one kept when every key is the last call's,
   else `compute()`'s, kept for next time. */
export function remember<V>(memo: Memo<V>, keys: readonly unknown[], compute: () => V): V {
  const last = memo.last
  if (last !== undefined && last.keys.length === keys.length && last.keys.every((key, i) => Object.is(key, keys[i]))) return last.value
  const value = compute()
  memo.last = { keys, value }
  return value
}
