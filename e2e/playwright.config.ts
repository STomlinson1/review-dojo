import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'specs',
  testMatch: '**/*.e2e.ts',
  outputDir: '.artifacts/results',
  globalSetup: './global-setup.ts',
  fullyParallel: true,
  workers: 4,
  retries: 0,
  forbidOnly: true,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
})
