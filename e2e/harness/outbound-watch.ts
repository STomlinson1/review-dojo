import { execFileSync, spawn } from 'node:child_process'

const SAMPLE_MS = 200
const LOOPBACK = /^(127\.0\.0\.1|\[::1\]|localhost):/

function processTree(root: number): number[] {
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .map((row) => row.trim().split(/\s+/).map(Number))
  const found: number[] = [root]
  const visit = (pid: number) => {
    for (const [child, parent] of rows) {
      if (parent !== pid) continue
      found.push(child)
      visit(child)
    }
  }
  visit(root)
  return found
}

function remoteEnds(pids: number[]): string[] {
  if (pids.length === 0) return []
  let listing = ''
  try {
    listing = execFileSync('lsof', ['-nP', '-iTCP', '-a', '-p', pids.join(',')], { encoding: 'utf8' })
  } catch (error) {
    // lsof exits 1 when a listed process has no sockets or has already gone; what it printed still counts.
    const failure = error as { status?: number | null; stdout?: string }
    if (failure.status !== 1) throw error
    listing = String(failure.stdout ?? '')
  }
  return listing
    .split('\n')
    .map((line) => /^(\S+)\s.*->(\S+)/.exec(line))
    .filter((match) => match !== null && !LOOPBACK.test(match[2]))
    .map((match) => `${match![1]} -> ${match![2]}`)
}

const [command, ...args] = process.argv.slice(2)
if (!command) {
  console.error('usage: tsx e2e/harness/outbound-watch.ts <command> [arguments]')
  process.exit(2)
}

const child = spawn(command, args, { stdio: 'inherit' })
const seen = new Set<string>()
let samples = 0
let unableToSample: Error | null = null
const timer = setInterval(() => {
  try {
    samples += 1
    for (const end of remoteEnds(processTree(child.pid!))) seen.add(end)
  } catch (error) {
    unableToSample = error as Error
    clearInterval(timer)
    child.kill()
  }
}, SAMPLE_MS)

child.on('exit', (code) => {
  clearInterval(timer)
  if (unableToSample) {
    console.error(`outbound-watch: could not sample connections, stopped the command: ${unableToSample.message}`)
    process.exit(1)
  }
  console.log(`outbound-watch: ${samples} samples, ${seen.size} connections beyond loopback`)
  for (const end of seen) console.log(`  ${end}`)
  process.exit(code !== 0 ? (code ?? 1) : seen.size > 0 ? 1 : 0)
})
