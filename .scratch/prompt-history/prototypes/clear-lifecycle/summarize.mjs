#!/usr/bin/env node

// THROWAWAY PROTOTYPE. Summarizes trace.jsonl without third-party packages.
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const tracePath = resolve(process.argv[2] ?? resolve(here, 'trace.jsonl'))
const text = await readFile(tracePath, 'utf8')
const records = text
  .split('\n')
  .filter(Boolean)
  .map(line => JSON.parse(line))

const firstMs = Date.parse(records[0]?.at ?? new Date().toISOString())
const modules = new Map()

for (const record of records) {
  if (!modules.has(record.moduleInstanceId)) {
    modules.set(record.moduleInstanceId, modules.size + 1)
  }

  const delta = String(Date.parse(record.at) - firstMs).padStart(7)
  const moduleNumber = modules.get(record.moduleInstanceId)
  const data = record.data ? ` ${JSON.stringify(record.data)}` : ''
  console.log(
    `${String(record.sequence).padStart(4)} +${delta}ms M${moduleNumber} ${record.event}.${record.phase}${data}`,
  )
}

console.log(`\n事件数: ${records.length}; module instance 数: ${modules.size}`)

const clearStarts = records.filter(
  record =>
    record.event === 'command.run' &&
    record.phase === 'before' &&
    record.data?.command === 'clear',
)
const clearEnds = records.filter(
  record =>
    record.event === 'classic.SessionEnd' &&
    record.phase === 'before' &&
    record.data?.reason === 'clear',
)
const clearRestarts = records.filter(
  record =>
    record.event === 'classic.SessionStart' &&
    record.phase === 'before' &&
    record.data?.source === 'clear',
)
const processStarts = records.filter(
  record => record.event === 'session.start' && record.phase === 'before',
)

console.log('\nClear 快速检查:')
console.log(`- command.run(clear): ${clearStarts.length}`)
console.log(`- classic.SessionEnd(reason=clear): ${clearEnds.length}`)
console.log(`- classic.SessionStart(source=clear): ${clearRestarts.length}`)
console.log(`- session.start（进程启动/插件 reload）: ${processStarts.length}`)
console.log('- 请以完整序列判断 prompt.context、ui.render 与 module instance 的相对顺序。')
