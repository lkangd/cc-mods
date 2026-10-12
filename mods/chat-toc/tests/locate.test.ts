import { expect, test } from 'claude-code/testing'
import { derivedTranscriptPath, projectDirName } from '../hooks/locate'

/* Where a session's transcript file is when no classic event said it (a
   plugin enabled in mid-session hears only `session.start`): the host's
   own rule for the project folder's name, read from 2.1.287's and 2.1.295's
   binaries and checked against the folders they made. */

/* The spike's 262-character working directory and the folder both hosts made
   for it (runs A1-2.1.287 and A1-2.1.295). */
const LONG_SEGMENTS = 'long-segment-'.repeat(14)
const LONG_CWD_287 = `/private/var/folders/nh/5vhmfmd556j33t3g996v6c080000gn/T/ctoc-tcfwnoaa/项目 a.b_c/${LONG_SEGMENTS}`
const LONG_CWD_295 = `/private/var/folders/nh/5vhmfmd556j33t3g996v6c080000gn/T/ctoc-ugogyp0w/项目 a.b_c/${LONG_SEGMENTS}`
const LONG_DIR_287 =
  '-private-var-folders-nh-5vhmfmd556j33t3g996v6c080000gn-T-ctoc-tcfwnoaa----a-b-c-long-segment-long-segment-long-segment-long-segment-long-segment-long-segment-long-segment-long-segment-long-segment-lon-o9npe6'
const LONG_DIR_295 =
  '-private-var-folders-nh-5vhmfmd556j33t3g996v6c080000gn-T-ctoc-ugogyp0w----a-b-c-long-segment-long-segment-long-segment-long-segment-long-segment-long-segment-long-segment-long-segment-long-segment-lon-fwv17r'

test('every character but an ASCII letter or digit becomes a dash, one per UTF-16 unit', () => {
  expect(projectDirName('/home/synthetic/project')).toBe('-home-synthetic-project')
  expect(projectDirName('/Users/a/项目 x/😀.y')).toBe('-Users-a----x----y')
  expect(projectDirName('C:\\Users\\a\\my_proj')).toBe('C--Users-a-my-proj')
})

test('a name over 200 characters keeps its first 200 and ends in a base-36 hash of the path', () => {
  expect(LONG_CWD_287.length).toBe(262)
  expect(projectDirName(LONG_CWD_287)).toBe(LONG_DIR_287)
  expect(projectDirName(LONG_CWD_295)).toBe(LONG_DIR_295)
})

test('a name of exactly 200 characters is kept whole', () => {
  const cwd = '/' + 'a'.repeat(199)
  expect(projectDirName(cwd)).toBe('-' + 'a'.repeat(199))
})

test('the file is <config dir>/projects/<folder>/<session id>.jsonl, the config dir CLAUDE_CONFIG_DIR first', () => {
  const where = { sessionId: 'abc', cwd: '/home/u/p' }
  expect(derivedTranscriptPath({ ...where, configDir: '/cfg/.claude', home: '/home/u' })).toBe('/cfg/.claude/projects/-home-u-p/abc.jsonl')
  expect(derivedTranscriptPath({ ...where, configDir: '/cfg/.claude/', home: '/home/u' })).toBe('/cfg/.claude/projects/-home-u-p/abc.jsonl')
  expect(derivedTranscriptPath({ ...where, home: '/home/u' })).toBe('/home/u/.claude/projects/-home-u-p/abc.jsonl')
})

test('on Windows the home is USERPROFILE and the path is joined with backslashes', () => {
  const where = { sessionId: 'abc', cwd: 'C:\\Users\\u\\p' }
  expect(derivedTranscriptPath({ ...where, home: '/c/Users/u', userProfile: 'C:\\Users\\u' })).toBe('C:\\Users\\u\\.claude\\projects\\C--Users-u-p\\abc.jsonl')
  expect(derivedTranscriptPath({ ...where, configDir: 'D:\\cfg\\' })).toBe('D:\\cfg\\projects\\C--Users-u-p\\abc.jsonl')
})

test('without a session id, a working directory or anywhere to look, there is no path', () => {
  expect(derivedTranscriptPath({ sessionId: '', cwd: '/home/u/p', home: '/home/u' })).toBeUndefined()
  expect(derivedTranscriptPath({ sessionId: 'abc', cwd: '', home: '/home/u' })).toBeUndefined()
  expect(derivedTranscriptPath({ sessionId: 'abc', cwd: '/home/u/p' })).toBeUndefined()
  expect(derivedTranscriptPath({ sessionId: 'abc', cwd: 'C:\\p', home: '/c/Users/u' })).toBeUndefined()
})
