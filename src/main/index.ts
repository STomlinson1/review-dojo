import { join, relative, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, ipcMain, nativeTheme, net, protocol, shell } from 'electron'
import { Docent } from '../engine/docent'
import { channel, invokeMethods, PROGRESS_CHANNEL } from '../shared/api'
import { createHandlers } from './handlers'
import { SettingsStore } from './settings'
import { adoptLoginShellPath } from './shellPath'

const APP_ORIGIN = 'app://docent'
const rendererDir = join(import.meta.dirname, '../renderer')
const devServerUrl = process.env.ELECTRON_RENDERER_URL

// Module workers (the diff highlighter) cannot load from file:// origins, so production assets are
// served from a privileged custom scheme.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

function serveRenderer(): void {
  protocol.handle('app', (request) => {
    const target = join(rendererDir, decodeURIComponent(new URL(request.url).pathname))
    const inside = relative(rendererDir, target)
    if (inside.startsWith('..') || isAbsolute(inside)) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(target).toString())
  })
}

function isAppUrl(url: string): boolean {
  return url.startsWith(`${APP_ORIGIN}/`) || (devServerUrl !== undefined && url.startsWith(devServerUrl))
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1080,
    minHeight: 640,
    title: 'Docent',
    titleBarStyle: 'hiddenInset',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16171a' : '#fbfbfa',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault()
  })

  void window.loadURL(devServerUrl ?? `${APP_ORIGIN}/index.html`)
  return window
}

async function main(): Promise<void> {
  await app.whenReady()
  await adoptLoginShellPath()
  serveRenderer()

  const dataDir = app.getPath('userData')
  const window = createWindow()
  const handlers = createHandlers(new Docent(dataDir), new SettingsStore(dataDir), (event) => {
    if (!window.isDestroyed()) window.webContents.send(PROGRESS_CHANNEL, event)
  })

  for (const method of invokeMethods) {
    const handler = handlers[method] as (...args: unknown[]) => Promise<unknown>
    ipcMain.handle(channel(method), (event, ...args: unknown[]) => {
      if (!event.senderFrame || !isAppUrl(event.senderFrame.url)) throw new Error('Untrusted sender.')
      return handler(...args)
    })
  }

  app.on('window-all-closed', () => app.quit())
}

void main()
