/* Where the session's transcript file is when no classic event has said it:
   a plugin enabled in mid-session hears `session.start` alone, which has no
   `transcript_path`. The file is `<config dir>/projects/<folder>/<session
   id>.jsonl`, the folder named from the working directory by the host's own
   rule, read from 2.1.287's and 2.1.295's binaries (not a public contract):
   every UTF-16 unit but an ASCII letter or digit becomes `-`, and a name over
   200 units keeps its first 200 and ends in `-` and a base-36 hash of the
   path. Any classic event's `transcript_path` replaces what is worked out
   here. register.tsx asks `$` for the parts. */

const NAME_LIMIT = 200

/* Java's String.hashCode over UTF-16 units, as the host computes it. */
function javaHash(text: string): number {
  let h = 0
  for (let i = 0; i < text.length; i++) h = ((h << 5) - h + text.charCodeAt(i)) | 0
  return h
}

export function projectDirName(cwd: string): string {
  const name = cwd.replace(/[^a-zA-Z0-9]/g, '-')
  if (name.length <= NAME_LIMIT) return name
  return `${name.slice(0, NAME_LIMIT)}-${Math.abs(javaHash(cwd)).toString(36)}`
}

const isWindowsPath = (path: string) => /^[A-Za-z]:[\\/]/.test(path)

export type Whereabouts = {
  sessionId: string
  cwd: string
  /* CLAUDE_CONFIG_DIR, HOME and USERPROFILE, where set. */
  configDir?: string
  home?: string
  userProfile?: string
}

/* The transcript's path, or undefined when a part is missing. The config
   dir is CLAUDE_CONFIG_DIR, else `.claude` in the home: USERPROFILE on
   Windows, HOME elsewhere. */
export function derivedTranscriptPath(w: Whereabouts): string | undefined {
  if (!w.sessionId || !w.cwd) return undefined
  const isWindows = isWindowsPath(w.cwd)
  const sep = isWindows ? '\\' : '/'
  const home = isWindows ? w.userProfile : w.home
  const configDir = w.configDir || (home ? `${home.replace(/[\\/]+$/, '')}${sep}.claude` : undefined)
  if (!configDir) return undefined
  return [configDir.replace(/[\\/]+$/, ''), 'projects', projectDirName(w.cwd), `${w.sessionId}.jsonl`].join(sep)
}
