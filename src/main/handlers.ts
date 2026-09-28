import { shell } from 'electron'
import { Dojo, type TaskContext } from '../engine/dojo'
import { currentUser, listReviewRequests } from '../engine/github'
import { createProvider } from '../engine/providers'
import type { InvokeMethod } from '../shared/api'
import { PROVIDER_IDS } from '../shared/providers'
import type { DojoApi, EnvironmentStatus, ProgressEvent, ProviderId } from '../shared/types'
import type { SettingsStore } from './settings'

type Handlers = Pick<DojoApi, InvokeMethod>

export function createHandlers(dojo: Dojo, settings: SettingsStore, emit: (event: ProgressEvent) => void): Handlers {
  const tasks = new Map<string, AbortController>()

  async function task<T>(taskId: string, work: (context: TaskContext) => Promise<T>): Promise<T> {
    const controller = new AbortController()
    tasks.set(taskId, controller)
    try {
      return await work({ signal: controller.signal, onEvent: (event) => emit({ taskId, ...event }) })
    } finally {
      tasks.delete(taskId)
    }
  }

  async function provider(id?: ProviderId) {
    const chosen = id ?? (await settings.load()).provider
    return createProvider(chosen, await settings.providerConfig(chosen))
  }

  return {
    async environment(): Promise<EnvironmentStatus> {
      const [gh, claude, codex] = await Promise.all([
        currentUser().then(
          (user) => ({ ready: true, user, detail: `Signed in to GitHub as ${user}.` }),
          () => ({ ready: false, user: null, detail: 'Run `gh auth login` in a terminal to connect GitHub.' }),
        ),
        ...PROVIDER_IDS.map(async (id) => ({
          ...(await (await provider(id)).status()),
          hasApiKey: (await settings.apiKey(id)) !== null,
        })),
      ])
      return { gh, providers: { claude, codex } }
    },
    getSettings: () => settings.load(),
    saveSettings: (next) => settings.save(next),
    setApiKey: (id, key) => settings.setApiKey(id, key),

    listReviewRequests: () => listReviewRequests(),
    recentReviews: () => dojo.recentReviews(),
    openPullRequest: (url, taskId) => task(taskId, (context) => dojo.openPullRequest(url, context)),
    generateTour: (ref, taskId) => task(taskId, async (context) => dojo.generateTour(ref, await provider(), context)),
    ask: (ref, stopId, question, taskId) =>
      task(taskId, async (context) => dojo.ask(ref, await provider(), stopId, question, context)),
    gradePrediction: (ref, stopId, prediction, taskId) =>
      task(taskId, async (context) => dojo.gradePrediction(ref, await provider(), stopId, prediction, context)),
    polishComment: (ref, draft, taskId) =>
      task(taskId, async (context) => dojo.polishComment(ref, await provider(), draft, context)),
    async cancel(taskId) {
      tasks.get(taskId)?.abort()
    },

    saveReview: async (review) => dojo.saveReview(review),
    submitReview: (review, event) => dojo.submitReview(review, event),
    refreshLessons: (ref, taskId) =>
      task(taskId, async (context) => dojo.refreshLessons(ref, await provider(), context)),
    readFile: (ref, path, version) => dojo.readFile(ref, path, version),
    resolvePath: (ref, path) => dojo.resolvePath(ref, path),
    async openExternal(url) {
      if (new URL(url).protocol !== 'https:') throw new Error('Only https links can be opened.')
      await shell.openExternal(url)
    },
  }
}
