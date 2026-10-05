import { existsSync, readFileSync } from 'node:fs'
import { type ElectronApplication, type Page, _electron, test as base, expect } from '@playwright/test'
import { Gh } from '../harness/gh'
import type { ProviderId } from '../../src/shared/types'
import { BIN, type Run, SEED_SETTINGS, appArgs, appEnv, prepareRun, runPaths } from '../harness/launcher'
import { type Mock, startMock } from '../harness/mock-api'
import { ELECTRON, MANIFEST } from '../harness/paths'
import { type Manifest, readManifest } from '../harness/remotes'
import { pullRequest, signedIn } from '../harness/world'

/** The home screen loads reviewer avatars from GitHub; the proxy refuses them like everything else. */
const RENDERER_HOSTS = ['avatars.githubusercontent.com:443']

export interface Dojo {
  run: Run
  gh: Gh
  mock: Mock
  prs: Manifest['prs']
  launch(): Promise<Page>
  close(): Promise<void>
  openedLinks(): string[]
}

export const test = base.extend<{ dojo: Dojo; provider: ProviderId }>({
  provider: ['claude', { option: true }],

  dojo: async ({ provider }, use, testInfo) => {
    const manifest = readManifest(MANIFEST)
    const dir = testInfo.outputPath('run')
    const mock = await startMock(runPaths(dir).mockLog)
    const run = prepareRun(dir, mock.url, { ...SEED_SETTINGS, provider })
    const gh = new Gh(run.ghScript, run.ghLog)
    signedIn(gh)
    pullRequest(gh, manifest.prs.widget)

    let app = null as ElectronApplication | null
    let page = null as Page | null
    const pageErrors: string[] = []

    const close = async () => {
      if (!app) return
      const closing = app
      app = null
      await closing.context().tracing.stop({ path: testInfo.outputPath(`trace-${Date.now()}.zip`) })
      await closing.close()
    }

    const launch = async () => {
      await close()
      app = await _electron.launch({
        executablePath: ELECTRON,
        args: appArgs(run, mock.url),
        env: appEnv(run, mock.url, manifest.remotes),
      })
      await app.context().tracing.start({ screenshots: true, snapshots: true })
      page = await app.firstWindow()
      page.on('pageerror', (error) => pageErrors.push(error.message))
      const path = await app.evaluate(() => process.env.PATH ?? '')
      if (path.split(':')[0] !== BIN) throw new Error(`The fake gh is not first on the app's PATH: ${path}`)
      return page
    }

    await use({
      run,
      gh,
      mock,
      prs: manifest.prs,
      launch,
      close,
      openedLinks: () => (existsSync(run.openLog) ? readFileSync(run.openLog, 'utf8').split('\n').filter(Boolean) : []),
    })

    if (testInfo.status !== testInfo.expectedStatus) {
      await page?.screenshot({ path: testInfo.outputPath('failure.png') }).catch(() => undefined)
    }
    await close()
    await mock.close()
    expect
      .soft(
        gh.unscripted().map((call) => `gh ${call.argv.join(' ')}`),
        'gh calls nobody scripted',
      )
      .toEqual([])
    expect.soft(pageErrors, 'uncaught errors in the renderer').toEqual([])
    expect.soft(mock.unexpected, 'model API requests the mock did not expect').toEqual([])
    expect.soft(mock.pending(), 'scripted model turns nobody consumed').toBe(0)
    expect
      .soft(
        mock.blocked.filter((target) => !RENDERER_HOSTS.includes(target)),
        'connections attempted beyond loopback',
      )
      .toEqual([])
  },
})

export { expect }
