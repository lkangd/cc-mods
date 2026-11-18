import { expect, test } from 'claude-code/testing'
import { activeScopeKey, normalizeSettings, settingsKey, systemIsChinese } from '../hooks/config'
import { translationRequest, translationResult } from '../hooks/deepseek'
import { convertPunctuation, hasSourceLanguage } from '../hooks/text'

test('punctuation conversion preserves code, URLs, paths, and decimal numbers', () => {
  const source = 'Check `call(a,b)` and https://example.com/a.b, ./src/a.ts; version 3.14 is ready!'
  expect(convertPunctuation(source, 'en-zh')).toBe('Check `call(a,b)` and https://example.com/a.b， ./src/a.ts； version 3.14 is ready！')
  expect(convertPunctuation('你好，世界！`x，y`', 'zh-en')).toBe('你好,世界!`x，y`')
  expect(convertPunctuation('See [guide](https://example.com/a.b), src/main.ts and @lib/a.ts.', 'en-zh'))
    .toBe('See [guide](https://example.com/a.b)， src/main.ts and @lib/a.ts。')
  expect(convertPunctuation('"Don\'t stop!"', 'en-zh')).toBe('“Don\'t stop！”')
})

test('source language detection ignores protected spans', () => {
  expect(hasSourceLanguage('`中文` https://example.com/中文', 'zh-en')).toBe(false)
  expect(hasSourceLanguage('Translate this sentence.', 'en-zh')).toBe(true)
  expect(hasSourceLanguage('[你好](https://example.com)', 'zh-en')).toBe(true)
})

test('all Markdown code delimiters and technical addresses stay unchanged', () => {
  const text = 'README.md; mailto:user@example.com; ftp://example.com/a.b; ``a,b``;\n~~~ts\na,b\n~~~\n;\n```ts\na,b'
  expect(convertPunctuation(text, 'en-zh')).toBe('README.md； mailto:user@example.com； ftp://example.com/a.b； ``a,b``；\n~~~ts\na,b\n~~~\n；\n```ts\na,b')
})

test('DeepSeek request follows the fixed API contract and restores protected content', () => {
  const request = translationRequest('synthetic-key', '你好 `const x=1`', 'zh-en')
  const body = JSON.parse(request.init.body ?? '{}') as { model: string; stream: boolean; messages: Array<{ content: string }> }
  expect(body.model).toBe('deepseek-chat')
  expect(body.stream).toBe(false)
  expect(body.messages[1]?.content).toContain('__CI_KEEP_0__')
  const result = translationResult({ ok: true, status: 200, headers: {}, text: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'Hello __CI_KEEP_0__' } }] }) }, request.values)
  expect(result).toBe('Hello `const x=1`')
  expect(() => translationResult({ ok: true, status: 200, headers: {}, text: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'Hello (missing marker)' } }] }) }, request.values)).toThrow()
  const collision = translationRequest('synthetic-key', '你好 `__CI_KEEP_0__`', 'zh-en')
  const marker = collision.values[0]?.[0]
  expect(marker).toBeDefined()
  expect(translationResult({ ok: true, status: 200, headers: {}, text: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: `Hello ${marker}` } }] }) }, collision.values)).toBe('Hello `__CI_KEEP_0__`')
})

test('project and global settings are independent and default to off', () => {
  const project = normalizeSettings({ translateInput: true, inputDirection: 'en-zh' })
  const global = normalizeSettings()
  expect(project.translateInput).toBe(true)
  expect(global.translateInput).toBe(false)
  expect(global.sendOnlyOnSuccess).toBe(true)
  expect(settingsKey('project', '/repo')).not.toBe(settingsKey('global', '/repo'))
  expect(activeScopeKey('/repo')).toBe('active-scope:/repo')
  expect(systemIsChinese(['en_US.UTF-8', undefined, 'zh_CN.UTF-8'])).toBe(false)
  expect(systemIsChinese(['', 'zh_CN.UTF-8', 'en_US.UTF-8'])).toBe(true)
})
