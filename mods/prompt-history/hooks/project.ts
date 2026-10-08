/* Which directory a Project Timeline belongs to, decided as a pure function
   over what Git answered for the directory Claude Code started in.

   Git is asked with the variables that could point it at another repository
   removed, so the answer depends on the start directory alone. A Mac without
   the Command Line Tools answers through a shim that fails with its own exit
   code, so any failure counts as "not a repository" once no `.git` above the
   start directory says otherwise. */

const GIT_REDIRECTS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_CEILING_DIRECTORIES']

export function gitToplevelArgv(directory: string): string[] {
  return [
    '/usr/bin/env',
    ...GIT_REDIRECTS.flatMap(name => ['-u', name]),
    '/usr/bin/git',
    '-C',
    directory,
    'rev-parse',
    '--show-toplevel',
  ]
}

/* The project root before its own `realpath`, or undefined when it cannot be
   proven: Git's answer is not a plain absolute path, or Git failed inside
   what a `.git` above the start directory says is a repository. */
export function projectRootFrom(
  canonicalCwd: string,
  git: { exitCode: number; stdout: string },
  insideGitRepository: boolean,
): string | undefined {
  if (git.exitCode !== 0) return insideGitRepository ? undefined : canonicalCwd
  const root = git.stdout.trim()
  if (!root.startsWith('/') || /[\u0000-\u001f\u007f]/.test(root)) return undefined
  return root
}
