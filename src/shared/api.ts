import type { DojoApi } from './types'

export type InvokeMethod = Exclude<keyof DojoApi, 'onProgress'>

/** Every request/response method on the bridge; typed as a record so a missing method fails to compile. */
const INVOKE_METHODS: Record<InvokeMethod, true> = {
  environment: true,
  getSettings: true,
  saveSettings: true,
  setApiKey: true,
  listReviewRequests: true,
  openPullRequest: true,
  generateTour: true,
  ask: true,
  gradePrediction: true,
  polishComment: true,
  cancel: true,
  saveReview: true,
  submitReview: true,
  readFile: true,
  resolvePath: true,
  openExternal: true,
}

export const invokeMethods = Object.keys(INVOKE_METHODS) as InvokeMethod[]

export const channel = (method: InvokeMethod) => `dojo:${method}`

export const PROGRESS_CHANNEL = 'dojo:progress'
