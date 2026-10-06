import { type ElectronApplication, type Page, _electron, test as base, expect } from '@playwright/test'
import type { ProviderId } from '../../src/shared/types'
import { type World, openWorld } from '../harness/launcher'
import { ELECTRON } from '../harness/paths'

/** The home screen loads reviewer avatars from GitHub; the proxy refuses them like everything else. */
const RENDERER_HOSTS = ['avatars.githubusercontent.com:443']

export interface Dojo extends World {
  launch(): Promise<Page>
  close(): Promise<void>
}

export const test = base.extend<{ dojo: Dojo; provider: ProviderId }>({
  provider: ['claude', { option: true }],

  dojo: async ({ provider }, use, testInfo) => {
    const world = await openWorld(testInfo.outputPath('run'), provider)
    const { gh, mock } = world

    let app = null as ElectronApplication | null
    let page = null as Page | null
    const pageErrors: string[] = []

    const close = async () => {
      if (!app) return
      const closing = app
      app = null
      try {
        await closing.context().tracing.stop({ path: testInfo.outputPath(`trace-${Date.now()}.zip`) })
      } finally {
        await closing.close()
      }
    }

    const launch = async () => {
      await close()
      app = await _electron.launch({ executablePath: ELECTRON, args: world.args, env: world.env })
      await app.context().tracing.start({ screenshots: true, snapshots: true })
      page = await app.firstWindow()
      page.on('pageerror', (error) => pageErrors.push(error.message))
      const path = await app.evaluate(() => process.env.PATH ?? '')
      if (path.split(':')[0] !== world.env.PATH.split(':')[0]) {
        throw new Error(`The fake gh is not first on the app's PATH: ${path}`)
      }
      return page
    }

    await use({ ...world, launch, close })

    if (testInfo.status !== testInfo.expectedStatus) {
      await page?.screenshot({ path: testInfo.outputPath('failure.png') }).catch(() => undefined)
    }
    try {
      await close()
    } finally {
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
    }
  },
})

export { expect }
