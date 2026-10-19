import { expect, test } from 'claude-code/testing'

test('the desktop pane draws every variant, and a press is counted', async $ => {
  const pane = await $.ui.mount({
    plugin: 'toc-probe',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'toc-probe',
    props: { title: 'TOC probe', isFocused: false, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  } as never)
  const text = JSON.stringify(await pane.drawn())
  for (const part of ['A · Markdown', 'B · ', 'C · ', 'D · ', 'E · ', 'G · ', 'H · ', 'toc-probe.invalid/a1', '09:12']) expect(text).toContain(part)
  await pane.press({ key: 'd1' })
  expect(JSON.stringify(await pane.drawn())).toContain('D d1')
})
