/* When the transcript is read again: a request waits 300 ms so a burst of
   appended rows is read once, a request made while a read runs is kept and
   run after it, and a finished turn looks once more 1.5 s later for rows the
   file received late. No polling.

   The gate holds only the decisions; the hooks module owns the timers and
   the read, since only it may hold the host's `$`. */

export const TRAILING_MS = 300
export const LATE_CHECK_MS = 1500

export type ReadGate = {
  isWaiting: boolean
  isReading: boolean
  isAgain: boolean
}

export function readGate(): ReadGate {
  return { isWaiting: false, isReading: false, isAgain: false }
}

/* A read is asked for: true when a trailing timer is to be started. */
export function gateRequest(gate: ReadGate): boolean {
  if (gate.isWaiting) return false
  gate.isWaiting = true
  return true
}

/* The trailing timer fired. */
export function gateFired(gate: ReadGate): void {
  gate.isWaiting = false
}

/* A read is to run now: true when it may start, false when one is under way
   (it will run again once that one finishes). */
export function gateStart(gate: ReadGate): boolean {
  if (gate.isReading) {
    gate.isAgain = true
    return false
  }
  gate.isReading = true
  return true
}

/* A read finished: true when another was asked for meanwhile. */
export function gateFinish(gate: ReadGate): boolean {
  gate.isReading = false
  const again = gate.isAgain
  gate.isAgain = false
  return again
}
