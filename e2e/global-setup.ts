import { execFileSync } from 'node:child_process'
import { buildFixtures } from './harness/remotes'
import { ARTIFACTS, REPO } from './harness/paths'

export default function globalSetup(): void {
  execFileSync('npm', ['run', 'build'], { cwd: REPO, stdio: ['ignore', 'ignore', 'inherit'] })
  buildFixtures(ARTIFACTS)
}
