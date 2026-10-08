import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const traceDirectory = path.join(
  process.cwd(),
  '.scratch/prompt-history/prototypes/scrollable-timeline/traces',
)

let files = []
try {
  files = (await readdir(traceDirectory))
    .filter(file => file.endsWith('.jsonl'))
    .sort()
} catch {
  console.log('尚无 trace。先按 README 完成真人交互走查。')
  process.exit(0)
}

if (files.length === 0) {
  console.log('尚无 trace。先按 README 完成真人交互走查。')
  process.exit(0)
}

for (const file of files) {
  const source = await readFile(path.join(traceDirectory, file), 'utf8')
  const records = source
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line))
  const counts = new Map()
  for (const record of records) {
    counts.set(record.event, (counts.get(record.event) ?? 0) + 1)
  }

  console.log(`\n${file}`)
  console.log(`  records: ${records.length}`)
  for (const [event, count] of [...counts.entries()].sort()) {
    console.log(`  ${event}: ${count}`)
  }

  const focusDenials = records
    .filter(record => record.event === 'focus.request' && record.deny)
    .map(record => `${record.reason}: ${record.deny}`)
  if (focusDenials.length > 0) {
    console.log('  focus denials:')
    focusDenials.forEach(value => console.log(`    - ${value}`))
  }

  const scrolls = records.filter(record => record.event === 'ui.scroll')
  if (scrolls.length > 0) {
    console.log('  scroll samples:')
    scrolls.slice(-8).forEach(record => {
      console.log(
        `    - by=${record.by} move=${record.moveBy} edge=${record.edge ?? '-'} view=${record.customViewStart} loaded=${record.loadedStart}`,
      )
    })
  }

  const outcomes = records.filter(record =>
    ['survey.yield', 'survey.restore', 'jump.request', 'jump.refused', 'parent.chosen'].includes(record.event),
  )
  if (outcomes.length > 0) {
    console.log('  decisive outcomes:')
    outcomes.forEach(record => console.log(`    - ${JSON.stringify(record)}`))
  }
}
