#!/usr/bin/env node

// THROWAWAY PROTOTYPE. Summarizes per-process JSONL traces without packages.
import { readdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const traceDirectory = resolve(process.argv[2] ?? resolve(here, 'traces'))
const files = (await readdir(traceDirectory))
  .filter(file => file.endsWith('.jsonl'))
  .sort()

if (files.length === 0) {
  console.log(`没有 trace：${traceDirectory}`)
  process.exit(0)
}

function text(value) {
  return JSON.stringify(value ?? '')
}

function transcriptUsers(transcript) {
  return (transcript?.messages ?? [])
    .filter(message => message.role === 'user')
    .map(message => ({
      text: message.text,
      toolResults: message.toolResultCount,
    }))
}

for (const [runIndex, file] of files.entries()) {
  const path = resolve(traceDirectory, file)
  const records = (await readFile(path, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line))
  const firstMs = Date.parse(records[0]?.at ?? new Date().toISOString())
  const modules = new Map()

  console.log(`\n=== Run ${runIndex + 1}: ${file} ===`)

  for (const record of records) {
    if (!modules.has(record.moduleInstanceId)) {
      modules.set(record.moduleInstanceId, modules.size + 1)
    }

    const delta = String(Date.parse(record.at) - firstMs).padStart(7)
    const prefix = `${String(record.sequence).padStart(4)} +${delta}ms M${modules.get(
      record.moduleInstanceId,
    )}`
    const data = record.data ?? {}

    if (record.event === 'manual.marker') {
      console.log(`${prefix} MARK ${data.label}`)
    } else if (record.event === 'manual.snapshot') {
      console.log(
        `${prefix} SNAPSHOT ${data.label} session=${data.sessionId} turns=${data.turns} users=${JSON.stringify(
          transcriptUsers(data),
        )}`,
      )
    } else if (record.event === 'prompt.submit') {
      console.log(
        `${prefix} prompt.submit.${record.phase} origin=${data.origin?.kind ??
          data.origin?.name ??
          '-'} text=${text(data.text)} users=${JSON.stringify(
          transcriptUsers(data.transcript),
        )}`,
      )
    } else if (record.event === 'classic.UserPromptSubmit') {
      console.log(
        `${prefix} classic.UserPromptSubmit.${record.phase} source=${data.source ??
          '-'} session=${data.sessionId} prompt=${text(data.prompt)}`,
      )
    } else if (record.event === 'ui.render.UserMessage') {
      console.log(
        `${prefix} UserMessage request=${data.requestId} origin=${data.origin?.kind ??
          '-'} text=${text(data.text)}`,
      )
    } else if (record.event === 'prompt.fill') {
      console.log(
        `${prefix} prompt.fill.${record.phase} text=${text(data.text)} filled=${
          data.isFilled ?? '-'
        }`,
      )
    } else if (
      record.event === 'classic.SessionStart' ||
      record.event === 'classic.SessionEnd'
    ) {
      console.log(
        `${prefix} ${record.event}.${record.phase} source=${data.source ??
          '-'} reason=${data.reason ?? '-'} session=${data.sessionId}`,
      )
    } else if (record.event === 'session.start') {
      console.log(
        `${prefix} session.start.${record.phase} session=${data.sessionId ?? '-'}`,
      )
    } else if (
      record.event === 'command.run' &&
      record.phase === 'before'
    ) {
      console.log(
        `${prefix} command /${data.command} ${data.args ?? ''} session=${data.sessionId}`,
      )
    } else if (record.event === 'turn.start' && record.phase === 'before') {
      console.log(
        `${prefix} turn.start id=${data.turnId} text=${text(data.text)} users=${JSON.stringify(
          transcriptUsers(data.transcript),
        )}`,
      )
    } else if (record.event === 'turn.complete' && record.phase === 'after') {
      console.log(
        `${prefix} turn.complete id=${data.turnId} reason=${data.reason} users=${JSON.stringify(
          transcriptUsers(data.transcript),
        )}`,
      )
    } else if (record.event === 'session.compact') {
      console.log(
        `${prefix} session.compact.${record.phase} trigger=${data.trigger}`,
      )
    }
  }

  const composerPrompts = records.filter(
    record =>
      record.event === 'prompt.submit' &&
      record.phase === 'before' &&
      record.data?.origin?.kind === 'composer',
  )
  const classicUserPrompts = records.filter(
    record =>
      record.event === 'classic.UserPromptSubmit' &&
      record.phase === 'before' &&
      record.data?.source === 'user',
  )
  const renders = records.filter(
    record => record.event === 'ui.render.UserMessage',
  )
  const renderGroups = new Map()

  for (const render of renders) {
    const key = JSON.stringify([render.data?.requestId, render.data?.text])
    const group = renderGroups.get(key) ?? {
      requestId: render.data?.requestId,
      text: render.data?.text,
      count: 0,
    }
    group.count += 1
    renderGroups.set(key, group)
  }

  const sessionStarts = records
    .filter(
      record =>
        record.event === 'classic.SessionStart' && record.phase === 'before',
    )
    .map(record => ({
      source: record.data?.source,
      sessionId: record.data?.sessionId,
    }))

  console.log('\n快速检查:')
  console.log(
    `- module instances: ${modules.size}; probeRunId: ${records[0]?.probeRunId}; hostPid: ${records[0]?.hostPid}`,
  )
  console.log(`- classic session starts: ${JSON.stringify(sessionStarts)}`)
  console.log(
    `- composer prompt.submit: ${composerPrompts.length} ${JSON.stringify(
      composerPrompts.map(record => record.data?.text),
    )}`,
  )
  console.log(
    `- classic source=user: ${classicUserPrompts.length} ${JSON.stringify(
      classicUserPrompts.map(record => record.data?.prompt),
    )}`,
  )
  console.log(
    `- UserMessage 实例/重绘: ${renderGroups.size}/${renders.length} ${JSON.stringify(
      [...renderGroups.values()],
    )}`,
  )
}
