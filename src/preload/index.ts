import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { channel, invokeMethods, PROGRESS_CHANNEL } from '../shared/api'
import type { DocentApi, ProgressEvent } from '../shared/types'

const invokers = Object.fromEntries(
  invokeMethods.map((method) => [method, (...args: unknown[]) => ipcRenderer.invoke(channel(method), ...args)]),
)

const api = {
  ...invokers,
  onProgress(listener: (event: ProgressEvent) => void) {
    const handler = (_event: IpcRendererEvent, progress: ProgressEvent) => listener(progress)
    ipcRenderer.on(PROGRESS_CHANNEL, handler)
    return () => {
      ipcRenderer.removeListener(PROGRESS_CHANNEL, handler)
    }
  },
} as DocentApi

contextBridge.exposeInMainWorld('docent', api)
