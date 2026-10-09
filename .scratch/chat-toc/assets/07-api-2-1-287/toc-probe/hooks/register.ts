import type { Register, RenderElement } from 'claude-code'

let transcriptPath: string | undefined
const shown = new Map<string, { first: number; last: number; of: number }>()
const log: string[] = []

export const register: Register = (on) => {
  on('classic.SessionStart', async ($, e, next) => {
    transcriptPath = e.transcript_path
    return next(e)
  })
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'probe', description: 'probe' })
    return next(e)
  })
  on('session.end', async ($, e, next) => {
    const r: 'clear' | 'resume' | 'logout' | 'prompt_input_exit' | 'other' = e.reason
    log.push(`end:${r}`)
    return next(e)
  })
  on('session.append', async ($, e, next) => {
    const meta: true | undefined = e.message.isMeta
    log.push(`append:${e.door}:${e.uuid}:${e.agentId ?? '-'}:${meta ?? '-'}`)
    return next(e)
  })
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.props.onScreen) shown.set(e.requestId, e.props.onScreen)
    else shown.delete(e.requestId)
    return next(e)
  })
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.props.onScreen) shown.set(e.requestId, e.props.onScreen)
    return next(e)
  })
  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    void e.props.onScreen
    return next(e)
  })
  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    const placement: 'dock' | 'inline' = e.props.placement
    const cols: number = e.props.bodyColumns
    const { Box, Text, Button } = $.ui.resolve(e)
    return h(Box, { flexDirection: 'column' },
      h(Text, {}, `${placement} ${cols}`),
      h(Button, { key: 'jump', onPress: () => $.ui.scroll({ to: { requestId: [...shown.keys()][0] ?? 'x' }, block: 'start' }) }, 'jump')) as RenderElement
  })
  on('ui.close', async ($, e, next) => {
    const o: 'plugin' | 'person' | 'unload' = e.origin.kind
    log.push(`close:${e.id}:${o}`)
    return next(e)
  })
  on('command.run', { command: 'probe' }, async ($, e) => {
    const out: string[] = [`transcript_path=${transcriptPath}`]
    const opened = await $.ui.open({ id: 'toc', title: 'TOC', columns: 40 })
    out.push(`open.isPlaced=${opened.isPlaced}${opened.isPlaced ? '' : ' ' + opened.reason}`)
    const panes = await $.ui.panes()
    out.push(`panes=${JSON.stringify(panes)}`)
    const target = transcriptPath && (await $.fs.exists(transcriptPath)) ? transcriptPath : `${$.plugin.root}/../small.jsonl`
    out.push(`target=${target} exists(transcript)=${transcriptPath ? await $.fs.exists(transcriptPath) : 'n/a'}`)
    try {
      const st = await $.fs.stat(target)
      out.push(`stat kind=${st.kind} size=${st.size} mtime=${st.mtimeMs}`)
      const text = await $.fs.read(target)
      out.push(`read chars=${text.length} lines=${text.split('\n').length}`)
    } catch (err) { out.push(`stat/read err: ${String(err).slice(0, 300)}`) }
    const big = `${$.plugin.root}/../big.jsonl`
    try { await $.fs.read(big); out.push('big read: OK (unexpected)') }
    catch (err) { out.push(`big read rejects: ${String(err).slice(0, 160)}`) }
    const r = await $.process.run(['sh', '-c', `tail -c +4194000 "$1" | head -c 1000`, 'sh', big])
    out.push(`chunk exit=${r.exitCode} len=${r.stdout.length} trunc=${r.isStdoutTruncated}`)
    const r2 = await $.process.run(['cat', big])
    out.push(`cat big: len=${r2.stdout.length} trunc=${r2.isStdoutTruncated}`)
    await $.ui.close({ id: 'toc' })
    out.push(`log=${log.join(' | ').slice(0, 1500)}`)
    return { text: out.join('\n') }
  })
}
