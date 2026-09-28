import type { DocentApi, ProgressEvent } from '../../shared/types'

export const docent: DocentApi = window.docent

const IPC_PREFIX = /^Error invoking remote method '[^']+': (?:\w*Error: )?/

/** Electron wraps errors thrown in the main process; this recovers the original message. */
export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(IPC_PREFIX, '')
}

export interface Task<T> {
  id: string
  result: Promise<T>
}

export function startTask<T>(run: (taskId: string) => Promise<T>, onProgress: (event: ProgressEvent) => void): Task<T> {
  const id = crypto.randomUUID()
  const unsubscribe = docent.onProgress((event) => {
    if (event.taskId === id) onProgress(event)
  })
  return { id, result: run(id).finally(unsubscribe) }
}
