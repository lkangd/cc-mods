/* Timings for the long-session measurements (CT-PERF-001), kept only when
   the host runs with CHAT_TOC_PERF set, and written to the host's debug log
   (`--debug-file`), never to the screen or a file of chat-toc's own.

   A sample is numbers only: a duration in ms and counts beside it. No
   prompt, reply, uuid or path ever goes in (CT-SEC-001), which the shape of
   `note` keeps by construction. */

/* The debug log line's lead, for the scripts that read it back. */
export const PERF_LEAD = 'chat-toc-perf '
/* How long samples gather before lines take them. */
export const PERF_FLUSH_MS = 1000
/* The longest line written. */
export const PERF_LINE_MAX = 4000

export type PerfMetric =
  /* A read from the start of the file to the Turn groups, in ms; then the
     chunks read, the groups, the chain rows and the file's bytes. */
  | 'read.whole'
  /* A read of what the file grew by, the same way. */
  | 'read.tail'
  /* From the first main-loop row appended to the end of the read that took
     it into the model. */
  | 'append.model'
  /* The pane's drawing: its own work, then the whole hook with what it
     awaited of the host; entries listed and whether the table was rebuilt. */
  | 'pane'
  /* The Current position worked out once; the on-screen records and the
     drawable rows it looked through. */
  | 'position'
  /* The first drawing with entries, in ms since the module loaded. */
  | 'listed'

export type Perf = {
  isOn: boolean
  samples: Partial<Record<PerfMetric, number[][]>>
  isFlushQueued: boolean
}

export function newPerf(): Perf {
  return { isOn: false, samples: {}, isFlushQueued: false }
}

const clock = (globalThis as { performance?: { now(): number } }).performance
/* A monotonic ms clock, finer than Date where the environment has one. */
export function perfNow(): number {
  return clock === undefined ? Date.now() : clock.now()
}

const round = (n: number) => Math.round(n * 100) / 100

/* Keeps one sample while measuring; true when there is one to write. */
export function note(perf: Perf, metric: PerfMetric, values: readonly number[]): boolean {
  if (!perf.isOn) return false
  ;(perf.samples[metric] ??= []).push(values.map(v => (Number.isFinite(v) ? round(v) : -1)))
  return true
}

/* The lines that take the samples gathered since the last, each one metric's
   run of samples and no longer than PERF_LINE_MAX: the host cuts a debug log
   line at about 10,000 characters. */
export function takeLines(perf: Perf): string[] {
  const lines: string[] = []
  for (const [metric, samples] of Object.entries(perf.samples)) {
    let run: string[] = []
    let length = 0
    const flush = () => {
      if (run.length > 0) lines.push(`${PERF_LEAD}{${JSON.stringify(metric)}:[${run.join(',')}]}`)
      run = []
      length = PERF_LEAD.length + metric.length + 8
    }
    flush()
    for (const sample of samples ?? []) {
      const text = JSON.stringify(sample)
      if (length + text.length + 1 > PERF_LINE_MAX) flush()
      run.push(text)
      length += text.length + 1
    }
    flush()
  }
  perf.samples = {}
  return lines
}
