import { expect, test } from 'claude-code/testing'
import { activeScopeKey, normalizeSettings, settingsKey, systemIsChinese } from '../hooks/config'
import { convertPunctuation, hasTranslatableText, maskProtected, restoreProtected } from '../hooks/text'
import { planCacheCleanup } from '../hooks/cache'

test('punctuation conversion preserves code, URLs, paths, and decimal numbers', () => {
  const source = 'Check `call(a,b)` and https://example.com/a.b, ./src/a.ts; version 3.14 is ready!'
  expect(convertPunctuation(source, 'zh')).toBe('Check `call(a,b)` and https://example.com/a.b， ./src/a.ts； version 3.14 is ready！')
  expect(convertPunctuation('你好，世界！`x，y`', 'en')).toBe('你好,世界!`x，y`')
  expect(convertPunctuation('See [guide](https://example.com/a.b), src/main.ts and @lib/a.ts.', 'zh'))
    .toBe('See [guide](https://example.com/a.b)， src/main.ts and @lib/a.ts。')
  expect(convertPunctuation('"Don\'t stop!"', 'zh')).toBe('“Don\'t stop！”')
})

test('translatable text can be in any language and excludes protected spans', () => {
  expect(hasTranslatableText('`中文` https://example.com/中文')).toBe(false)
  expect(hasTranslatableText('Переведите это предложение.')).toBe(true)
  expect(hasTranslatableText('[你好](https://example.com)')).toBe(true)
})

test('all Markdown code delimiters and technical addresses stay unchanged', () => {
  const text = 'README.md; mailto:user@example.com; ftp://example.com/a.b; ``a,b``;\n~~~ts\na,b\n~~~\n;\n```ts\na,b'
  expect(convertPunctuation(text, 'zh')).toBe('README.md； mailto:user@example.com； ftp://example.com/a.b； ``a,b``；\n~~~ts\na,b\n~~~\n；\n```ts\na,b')
})

test('protected markers avoid collisions and reject missing or duplicated text', () => {
  const { masked, values } = maskProtected('你好 `__CI_KEEP_0__`')
  expect(masked).toBe('你好 __CI_KEEP_1__')
  expect(restoreProtected('Hello __CI_KEEP_1__', values)).toBe('Hello `__CI_KEEP_0__`')
  expect(() => restoreProtected('Hello', values)).toThrow()
  expect(() => restoreProtected('Hello __CI_KEEP_1__ __CI_KEEP_1__', values)).toThrow()
  expect(restoreProtected('Hello __CI_KEEP_0__', [['__CI_KEEP_0__', '`$&`']])).toBe('Hello `$&`')
})

test('project and global settings are independent and default to off', () => {
  const project = normalizeSettings({ translateInput: true, inputTarget: 'zh' })
  const global = normalizeSettings()
  expect(project.translateInput).toBe(true)
  expect(global.translateInput).toBe(false)
  expect(global.sendOnlyOnSuccess).toBe(true)
  expect(settingsKey('project', '/repo')).not.toBe(settingsKey('global', '/repo'))
  expect(activeScopeKey('/repo')).toBe('active-scope:/repo')
  expect(systemIsChinese(['en_US.UTF-8', undefined, 'zh_CN.UTF-8'])).toBe(false)
  expect(systemIsChinese(['', 'zh_CN.UTF-8', 'en_US.UTF-8'])).toBe(true)
})

test('cache eviction removes expired files and then oldest files until 900 MB', () => {
  const file = (row: string, date: string, size: number) => ({
    name: `session.${row}.reply.json`, kind: 'file', size, mtimeMs: Date.parse(date), isLink: false,
  })
  const plan = planCacheCleanup([
    file('expired', '2026-02-27', 1),
    file('oldest', '2026-02-28', 110_000_000),
    file('older', '2026-03-01', 60_000_000),
    file('newest', '2026-08-31', 850_000_000),
  ], Date.parse('2026-08-31'))
  expect(plan.remove).toEqual(['session.expired.reply.json', 'session.oldest.reply.json', 'session.older.reply.json'])
  expect(plan.keep).toEqual(['session.newest.reply.json'])
})
