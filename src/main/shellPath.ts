import { execFile } from 'node:child_process'

const MARKER = '__DOCENT_PATH__'

/**
 * Apps launched from Finder get a minimal PATH without Homebrew, so `gh` and `git` would not
 * resolve. Adopt the PATH of the user's login shell instead.
 */
export function adoptLoginShellPath(): Promise<void> {
  const shell = process.env.SHELL || '/bin/zsh'
  return new Promise((resolve) => {
    execFile(shell, ['-ilc', `printf '${MARKER}%s${MARKER}' "$PATH"`], { timeout: 5000 }, (error, stdout) => {
      const path = error ? null : new RegExp(`${MARKER}(.*)${MARKER}`).exec(stdout)?.[1]
      process.env.PATH = [path, process.env.PATH, '/opt/homebrew/bin', '/usr/local/bin'].filter(Boolean).join(':')
      resolve()
    })
  })
}
