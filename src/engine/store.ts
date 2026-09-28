import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { readJson, writeJson } from './jsonFile'
import { PROVIDER_IDS } from '../shared/providers'
import type { PrRef, ProviderId, ReviewState, TourRecord } from '../shared/types'

export class Store {
  constructor(private readonly dataDir: string) {}

  /** Review progress follows the newest tour, whichever provider produced it. */
  async latestTour(ref: PrRef, headSha: string): Promise<TourRecord | null> {
    const tours = await Promise.all(
      PROVIDER_IDS.map((provider) => readJson<TourRecord>(this.tourPath(ref, headSha, provider))),
    )
    return tours.reduce<TourRecord | null>(
      (latest, tour) => (tour && (!latest || tour.createdAt > latest.createdAt) ? tour : latest),
      null,
    )
  }

  saveTour(record: TourRecord): void {
    writeJson(this.tourPath(record.pr, record.headSha, record.provider), record)
  }

  /**
   * A new push starts a fresh review, but unsent drafts from the latest earlier head carry over
   * (flagged by `carriedFromSha`) rather than silently disappearing.
   */
  async loadReview(ref: PrRef, headSha: string): Promise<ReviewState> {
    const saved = await readJson<ReviewState>(this.reviewPath(ref, headSha))
    if (saved) return saved
    const fresh: ReviewState = {
      pr: ref,
      headSha,
      carriedFromSha: null,
      visitedStopIds: [],
      stops: {},
      drafts: [],
      chat: [],
      body: '',
      submittedReviewUrl: null,
    }
    const previous = await this.latestOtherReview(ref, headSha)
    if (!previous || (previous.drafts.length === 0 && !previous.body.trim())) return fresh
    return {
      ...fresh,
      carriedFromSha: previous.headSha,
      drafts: previous.drafts.map((draft) => ({ ...draft, stopId: null })),
      body: previous.body,
    }
  }

  saveReview(state: ReviewState): void {
    writeJson(this.reviewPath(state.pr, state.headSha), state)
  }

  private async latestOtherReview(ref: PrRef, headSha: string): Promise<ReviewState | null> {
    const names = await readdir(this.prDir(ref)).catch(() => [])
    const candidates = await Promise.all(
      names
        .filter((name) => name.endsWith('.review.json') && !name.startsWith(headSha))
        .map(async (name) => ({ name, modified: (await stat(join(this.prDir(ref), name))).mtimeMs })),
    )
    const latest = candidates.sort((a, b) => b.modified - a.modified)[0]
    return latest ? readJson<ReviewState>(join(this.prDir(ref), latest.name)) : null
  }

  private prDir(ref: PrRef): string {
    return join(this.dataDir, 'reviews', ref.owner, ref.repo, String(ref.number))
  }

  private tourPath(ref: PrRef, headSha: string, provider: ProviderId): string {
    return join(this.prDir(ref), `${headSha}.tour.${provider}.json`)
  }

  private reviewPath(ref: PrRef, headSha: string): string {
    return join(this.prDir(ref), `${headSha}.review.json`)
  }
}
