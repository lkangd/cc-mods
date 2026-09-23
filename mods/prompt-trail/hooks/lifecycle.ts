/* The Conversation Segment lifecycle, decided as a state machine over the
   classic session events and nothing else.

   It is kept apart from the hooks so a recorded lifecycle sequence can be
   replayed against it directly: every decision here is a pure function of the
   stored state and one event, and the archive write it asks for is described
   rather than performed. A `/clear` is the only transition it recognises —
   compaction, reload and UI replay reach it as events it deliberately ignores
   rather than as cases the caller has to remember to filter out. */

/* A lifecycle write the archive still owes. It carries identity and timing
   only: the fields `boundary-append` needs to land the very same event later,
   so a retry is idempotent rather than a second boundary. No prompt text and
   no draft ever enters it, because it lives in `$.store`. */
export type LifecycleWrite = {
  kind: 'clear'
  eventId: string
  runId: string
  segmentId: string
  branchId: string
  occurredAt: number
}

/* One `/clear` as the two classic events describe it: the end that wrote the
   Clear Boundary, and the start that later claimed it for a new Conversation
   Segment. A transition without `resumedSessionId` has not been claimed yet —
   which is an ordinary in-flight state inside one Run, and proof of an
   interrupted transition once another Run is reading it. */
export type ClearTransition = {
  eventId: string
  endedSessionId: string
  runId: string
  resumedSessionId?: string
  /* This transition displaced one that never saw its SessionStart. */
  priorUnfinished?: true
}

export type LifecycleState = {
  version: 1
  queue: LifecycleWrite[]
  clear?: ClearTransition
  /* A `source=clear` start arrived with no end to pair it with. There is no
     boundary to associate and none is invented; the fact is kept so the status
     report can say the transition was only half observed. */
  unobservedClear?: true
  /* The recovery queue refused to grow. Past this point lifecycle facts are
     being lost, which is a gap to report rather than a queue to extend. */
  overflowed?: true
  /* A queued write came back unreadable and was dropped rather than replayed
     into a refusal it could never pass. The Clear Boundary it named is gone,
     which is reported rather than passed over. */
  damaged?: true
}

export type LifecycleEvent =
  | { event: 'session-end'; sessionId: string; reason: string }
  | { event: 'session-start'; sessionId: string; source: string }

/* The fields a Clear Boundary needs beyond the event itself. `eventId` is
   derived from the ending classic session id, so the same `/clear` always names
   the same boundary however often it is replayed; `occurredAt` is taken once
   and replayed verbatim, because a drifted instant is a `boundary-conflict`. */
export type LifecycleWriteFields = {
  eventId: string
  branchId: string
  occurredAt: number
}

/* What the caller has proven about the current Run at the moment of the event.
   Only an end forms a write, so only an end carries `end`: a start that had to
   supply a derived id, a branch and a clock reading would be inventing three
   facts it has no use for. An end whose fields could not be resolved arrives
   without them and is answered `clear-deferred`. */
export type LifecycleContext = {
  runId: string
  end?: LifecycleWriteFields
}

/* Why the machine did what it did. The caller reports it; the tests assert on
   it, which is how a sequence that quietly stopped creating boundaries is told
   apart from one that correctly declined to. */
export type LifecycleNote =
  | 'not-clear'
  | 'clear-boundary'
  | 'clear-duplicate'
  | 'clear-associated'
  | 'clear-already-associated'
  | 'clear-unobserved'
  /* A `/clear` was seen but its boundary could not be formed — the branch it
     cuts was unreadable. The state is left untouched: the caller holds the
     deferral and completes it before the next Prompt Entry is archived. */
  | 'clear-deferred'

export type LifecycleDecision = {
  write?: LifecycleWrite
  state: LifecycleState
  note: LifecycleNote
}

/* One unwritten Clear Boundary per `/clear`, and a person has to work at
   producing sixteen in a row without the archive ever recovering. Past that the
   archive is not coming back on its own, so the queue stops growing instead of
   turning `$.store` into the unbounded index it must never become. */
export const LIFECYCLE_QUEUE_LIMIT = 16

export function emptyLifecycle(): LifecycleState {
  return { version: 1, queue: [] }
}

export function decideLifecycle(
  state: LifecycleState,
  event: LifecycleEvent,
  context: LifecycleContext,
): LifecycleDecision {
  if (event.event === 'session-end') {
    /* `resume`, `logout`, `prompt_input_exit` and `other` end a Run, not a
       Conversation Segment. Only `clear` cuts one. */
    if (event.reason !== 'clear') return { state, note: 'not-clear' }

    /* The same end seen twice — a replayed event, or a retry after the caller
       could not record what it did — names the same boundary. It is already
       either archived or queued, so nothing new is asked for. */
    if (state.clear?.endedSessionId === event.sessionId) {
      return { state, note: 'clear-duplicate' }
    }

    const end = context.end
    if (!end) return { state, note: 'clear-deferred' }

    const priorUnfinished = state.clear !== undefined
      && state.clear.resumedSessionId === undefined
    const write: LifecycleWrite = {
      kind: 'clear',
      eventId: end.eventId,
      runId: context.runId,
      /* The boundary ends the segment that is closing, so it is recorded
         against the session id that is going away, never the one replacing it. */
      segmentId: event.sessionId,
      branchId: end.branchId,
      occurredAt: end.occurredAt,
    }
    return {
      write,
      state: {
        ...state,
        clear: {
          eventId: end.eventId,
          endedSessionId: event.sessionId,
          runId: context.runId,
          ...(priorUnfinished ? { priorUnfinished: true as const } : {}),
        },
        unobservedClear: undefined,
      },
      note: 'clear-boundary',
    }
  }

  /* `startup`, `resume`, `fork` and `compact` open a session without ending a
     segment. `compact` in particular arrives inside the same Run and must not
     be mistaken for a clear. */
  if (event.source !== 'clear') return { state, note: 'not-clear' }

  const clear = state.clear
  /* Nothing to claim: the end that should have written the boundary was never
     seen. A boundary is not invented from a start alone. */
  if (!clear) {
    return { state: { ...state, unobservedClear: true }, note: 'clear-unobserved' }
  }
  /* Only the Run that cut the segment may claim the transition. Another Run's
     `/clear` reaching this record would otherwise mark an interrupted
     transition complete and stop it being reported as unfinished. */
  if (clear.runId !== context.runId) {
    return { state: { ...state, unobservedClear: true }, note: 'clear-unobserved' }
  }
  if (clear.resumedSessionId === event.sessionId) {
    return { state, note: 'clear-already-associated' }
  }
  /* A second start for a transition another session already claimed is a
     `/clear` whose own end went unobserved, not a reason for a second
     boundary. */
  if (clear.resumedSessionId !== undefined) {
    return { state: { ...state, unobservedClear: true }, note: 'clear-unobserved' }
  }
  return {
    state: { ...state, clear: { ...clear, resumedSessionId: event.sessionId } },
    note: 'clear-associated',
  }
}

export function queueLifecycleWrite(
  state: LifecycleState,
  write: LifecycleWrite,
): LifecycleState {
  if (state.queue.some(queued => queued.eventId === write.eventId)) return state
  if (state.queue.length >= LIFECYCLE_QUEUE_LIMIT) {
    return { ...state, overflowed: true }
  }
  return { ...state, queue: [...state.queue, write] }
}

export function dequeueLifecycleWrite(
  state: LifecycleState,
  eventId: string,
): LifecycleState {
  return { ...state, queue: state.queue.filter(queued => queued.eventId !== eventId) }
}

/* How far the latest `/clear` got. `open` is the ordinary in-flight state
   between the two events of one Run; `unfinished` is the same shape seen from a
   Run that cannot be the one that started it, which is exactly the process
   having exited between SessionEnd and SessionStart. The written boundary
   stands either way — this only says whether the transition completed. */
export function clearTransitionState(
  state: LifecycleState,
  runId: string | undefined,
): 'none' | 'open' | 'complete' | 'unfinished' {
  const clear = state.clear
  if (!clear) return 'none'
  if (clear.resumedSessionId !== undefined) return 'complete'
  return runId !== undefined && clear.runId === runId ? 'open' : 'unfinished'
}
