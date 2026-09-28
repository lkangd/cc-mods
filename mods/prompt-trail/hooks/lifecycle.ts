/* The Run and Conversation Segment lifecycle, decided as a state machine over
   the classic session events and nothing else.

   It is kept apart from the hooks so a recorded lifecycle sequence can be
   replayed against it directly: every decision here is a pure function of the
   stored state and one event, and the archive write it asks for is described
   rather than performed. A `/clear` is the only segment transition it
   recognises. A Run is the lineage of one conversation and outlives any
   process, so the Run transitions are a process attaching to it and leaving
   it: an exit leaves, and an in-process `/resume` leaves only once the next
   session turns out to belong to another Run. Compaction, reload and UI replay
   reach it as events it deliberately ignores rather than as cases the caller
   has to remember to filter out. */

/* A lifecycle write the archive still owes. It carries identity and timing
   only: the fields `boundary-append` needs to land the very same event later,
   so a retry is idempotent rather than a second boundary. No prompt text and
   no draft ever enters it, because it lives in `$.store`. */
export type LifecycleWrite = {
  kind: 'clear' | 'run-started' | 'run-attached' | 'run-detached'
  eventId: string
  runId: string
  segmentId: string
  branchId: string
  occurredAt: number
  /* The Archive generation in place when the fact happened, stamped as it is
     first saved; `null` when there was none or it could not be asked. A
     write owed to a generation since cleared or quarantined is dropped. */
  generation?: string | null
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
     into a refusal it could never pass. The boundary it named is gone, which
     is reported rather than passed over. */
  damaged?: true
  /* This Run's start boundary has been formed — queued, and so owed until it
     lands. A Run appears in the archive only once it archives something, and
     every later write of the Run is ordered after this one. */
  started?: true
  /* The latest process to take the Run up. Its opening boundary — the Run's
     start, or an attach — has been formed; `closed` once its detach has. */
  attachment?: Attachment
  /* The Integrity gap this Run owes: the archive cannot show that its records
     match the conversation, and says so before it records anything more. */
  gap?: OwedGap
}

/* Why a Run's records can no longer be proven to match its conversation. */
export type GapReason =
  /* A submission's hook failed and the host let the prompt through. */
  | 'fail-open'
  /* The process went while a `/clear` was being recorded. */
  | 'clear-unrecorded'
  | 'queue-overflow'
  | 'queue-damaged'
  | 'clear-unobserved'
  /* An owed boundary whose Archive generation could not be told apart from a
     cleared one, dropped rather than replayed into whichever stands. */
  | 'generation-unknown'

/* An Integrity gap owed to the archive, with the recovery boundary that
   follows it. Its fields are fixed when the loss is found, so every replay
   names the same event; the recovery is dated when the gap lands, and `landed`
   says the gap is in the archive and only the recovery is still owed. */
export type OwedGap = {
  eventId: string
  runId: string
  segmentId: string
  branchId: string
  occurredAt: number
  generation: string | null
  reasons: GapReason[]
  landed?: true
  recoveryAt?: number
}

/* The losses a Run's record already carries as flags: each is a gap to
   record, not only a line in the status report. */
export function lossReasons(state: LifecycleState): GapReason[] {
  return [
    ...(state.overflowed ? ['queue-overflow' as const] : []),
    ...(state.damaged ? ['queue-damaged' as const] : []),
    ...(state.unobservedClear ? ['clear-unobserved' as const] : []),
  ]
}

/* Owing a gap for these losses. Before the owed gap lands, a new loss is one
   more reason for the same gap; once it has landed, a new loss follows it and
   is a gap of its own. */
export function oweGap(
  state: LifecycleState,
  reasons: readonly GapReason[],
  fields: Omit<OwedGap, 'reasons' | 'landed' | 'recoveryAt'>,
): LifecycleState {
  const owed = state.gap
  if (owed && !owed.landed) {
    const merged = [...owed.reasons, ...reasons.filter(reason => !owed.reasons.includes(reason))]
    return merged.length === owed.reasons.length ? state : { ...state, gap: { ...owed, reasons: merged } }
  }
  return { ...state, gap: { ...fields, reasons: [...reasons] } }
}

/* The gap is in the archive; its recovery is dated now and replayed as such. */
export function landGap(state: LifecycleState, recoveryAt: number): LifecycleState {
  const owed = state.gap
  if (!owed || owed.landed) return state
  return { ...state, gap: { ...owed, landed: true, recoveryAt } }
}

/* The gap and its recovery are both in the archive: nothing is owed, and the
   losses it records are no longer reported as current. */
export function settleGap(state: LifecycleState): LifecycleState {
  const { gap: _gap, overflowed: _overflowed, damaged: _damaged, unobservedClear: _unobserved, ...rest } = state
  return rest
}

/* One process generation's stretch of a Run. `id` makes the attach and detach
   boundaries of this stretch its own, so leaving and coming back in the same
   process is a second stretch rather than a replay of the first; the caller
   derives it from the host and the stretch before it, so two writers opening
   the same stretch at once name the same boundary. `host` is the process
   generation, so a reload of the same process is recognised as the same
   stretch. */
export type Attachment = {
  id: string
  host: string
  /* The segment the stretch opened in. */
  segmentId: string
  closed?: true
  /* An in-process `/resume` began leaving: the detach it would write, kept
     until the next session shows whether the process really left the Run. */
  leaving?: LifecycleWrite
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
   without them: a `/clear` is answered `clear-deferred`, an exit
   `run-detach-unrecorded`. `host` is the process generation the event arrives
   in, which is what tells this process's attachment from another's. */
export type LifecycleContext = {
  runId: string
  host?: string
  end?: LifecycleWriteFields
}

/* Why the machine did what it did. The caller reports it; the tests assert on
   it, which is how a sequence that quietly stopped creating boundaries is told
   apart from one that correctly declined to. */
export type LifecycleNote =
  | 'not-clear'
  /* An exit of a process that never took the Run up — nothing archived, or
     another process's attachment: there is nothing of its own to close. */
  | 'run-not-attached'
  | 'run-detached'
  | 'run-detach-duplicate'
  /* An exit whose detach boundary could not be formed. The process is leaving,
     so nothing can complete it later; the attachment stays unclosed in the
     archive, which is exactly what an interrupted process looks like. */
  | 'run-detach-unrecorded'
  /* An in-process `/resume` began leaving; nothing is written until the next
     session shows which Run it belongs to. */
  | 'run-leaving'
  | 'run-started'
  | 'run-attached'
  | 'run-already-attached'
  /* The recovery queue is at capacity: the stretch is not opened, and the
     process writes nothing until the archive recovers. */
  | 'run-attach-refused'
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
   turning `$.store` into the unbounded index it must never become. A Run's
   boundaries are outside the limit: each attachment opens and closes once, so
   they cannot outgrow the processes that made them, and refusing one would
   leave the attachment recorded as opened or closed with no boundary ever owed
   for it. */
export const LIFECYCLE_QUEUE_LIMIT = 16

/* Every kind together. A Run's boundaries still cannot grow without bound:
   when the archive never recovers, each process that takes the Run up adds an
   opening and a detach, so the queue is capped as a whole too. Past it a
   boundary is refused and the loss recorded, never queued past what a read
   will take back. */
export const LIFECYCLE_QUEUE_CAPACITY = 64

export function emptyLifecycle(): LifecycleState {
  return { version: 1, queue: [] }
}

export function decideLifecycle(
  state: LifecycleState,
  event: LifecycleEvent,
  context: LifecycleContext,
): LifecycleDecision {
  if (event.event === 'session-end') {
    /* An in-process `/resume` swaps the classic session under the same host
       process. Whether the process leaves the Run depends on the session it
       resumes, which only the next start knows, so the detach is prepared and
       held rather than written. */
    if (event.reason === 'resume') return prepareLeaving(state, event.sessionId, context)
    /* `logout`, `prompt_input_exit` and `other` leave the Run. */
    if (event.reason !== 'clear') return detachRun(state, event.sessionId, context)

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

function ownsOpenAttachment(state: LifecycleState, host: string | undefined): boolean {
  const attachment = state.attachment
  return attachment !== undefined && !attachment.closed && attachment.host === host
}

function detachRun(
  state: LifecycleState,
  sessionId: string,
  context: LifecycleContext,
): LifecycleDecision {
  const attachment = state.attachment
  if (!attachment || attachment.host !== context.host) return { state, note: 'run-not-attached' }
  if (attachment.closed) return { state, note: 'run-detach-duplicate' }
  const end = context.end
  if (!end) return { state, note: 'run-detach-unrecorded' }
  return {
    write: {
      kind: 'run-detached',
      eventId: end.eventId,
      runId: context.runId,
      segmentId: sessionId,
      branchId: end.branchId,
      occurredAt: end.occurredAt,
    },
    state: { ...state, attachment: closeAttachment(attachment) },
    note: 'run-detached',
  }
}

function closeAttachment(attachment: Attachment): Attachment {
  const { leaving: _leaving, ...rest } = attachment
  return { ...rest, closed: true }
}

function prepareLeaving(
  state: LifecycleState,
  sessionId: string,
  context: LifecycleContext,
): LifecycleDecision {
  const attachment = state.attachment
  if (!attachment || !ownsOpenAttachment(state, context.host) || !context.end) {
    return { state, note: 'not-clear' }
  }
  return {
    state: {
      ...state,
      attachment: {
        ...attachment,
        leaving: {
          kind: 'run-detached',
          eventId: context.end.eventId,
          runId: context.runId,
          segmentId: sessionId,
          branchId: context.end.branchId,
          occurredAt: context.end.occurredAt,
        },
      },
    },
    note: 'run-leaving',
  }
}

/* Which boundary this process owes before its first write to the Run, if any.
   The Run's very first appearance is its start; any later process — or this
   one coming back after leaving — attaches. An open attachment of this same
   process generation is a reload, and owes nothing. */
export function attachmentOpening(
  state: LifecycleState,
  host: string,
): 'run-started' | 'run-attached' | undefined {
  if (ownsOpenAttachment(state, host)) return undefined
  return state.started ? 'run-attached' : 'run-started'
}

/* Opening this process's attachment, just before its first write of anything
   else, so a process that never collects leaves no trace. The Run's start goes
   ahead of whatever the Run already owes; an attach goes after it, because
   what is owed then belongs to an earlier attachment it follows. A held detach
   from an in-process `/resume` that stayed in the Run is simply dropped. */
export function attachRun(
  state: LifecycleState,
  write: Omit<LifecycleWrite, 'kind'>,
  attachment: { id: string; host: string },
): LifecycleDecision {
  const kind = attachmentOpening(state, attachment.host)
  if (!kind) return { state: stayAttached(state), note: 'run-already-attached' }
  const opening: LifecycleWrite = { kind, ...write }
  const queued = queueLifecycleWrite(state, opening)
  /* A queue at capacity refuses the opening. The stretch is not recorded as
     opened, so nothing later closes a boundary that was never owed. */
  if (!queued.queue.some(owed => owed.eventId === opening.eventId)) {
    return { state: queued, note: 'run-attach-refused' }
  }
  return {
    write: opening,
    state: {
      ...queued,
      started: true,
      attachment: { id: attachment.id, host: attachment.host, segmentId: write.segmentId },
    },
    note: kind,
  }
}

/* The process is still in this Run: an in-process `/resume` that led back to
   one of its sessions drops the detach it held. */
export function stayAttached(state: LifecycleState): LifecycleState {
  const current = state.attachment
  if (!current?.leaving) return state
  const { leaving: _leaving, ...stayed } = current
  return { ...state, attachment: stayed }
}

/* Closing an attachment this process left behind by resuming into another
   Run. The detach held at the resume is the one written, so it says where and
   when the process really left; one that could not be held is formed from the
   fields given and the segment the stretch opened in. */
export function detachAbandoned(
  state: LifecycleState,
  owner: { runId: string; host: string },
  fields: LifecycleWriteFields,
): LifecycleDecision {
  const attachment = state.attachment
  if (!attachment || !ownsOpenAttachment(state, owner.host)) {
    return { state, note: 'run-not-attached' }
  }
  const write: LifecycleWrite = attachment.leaving ?? {
    kind: 'run-detached',
    eventId: fields.eventId,
    runId: owner.runId,
    segmentId: attachment.segmentId,
    branchId: fields.branchId,
    occurredAt: fields.occurredAt,
  }
  return {
    write,
    state: {
      ...queueLifecycleWrite(state, write),
      attachment: closeAttachment(attachment),
    },
    note: 'run-detached',
  }
}

export function queueLifecycleWrite(
  state: LifecycleState,
  write: LifecycleWrite,
): LifecycleState {
  if (state.queue.some(queued => queued.eventId === write.eventId)) return state
  if (write.kind === 'clear' && state.queue.length >= LIFECYCLE_QUEUE_LIMIT) {
    return { ...state, overflowed: true }
  }
  if (state.queue.length >= LIFECYCLE_QUEUE_CAPACITY) return { ...state, overflowed: true }
  return {
    ...state,
    queue: write.kind === 'run-started' ? [write, ...state.queue] : [...state.queue, write],
  }
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
