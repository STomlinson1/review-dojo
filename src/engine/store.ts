import { readdir, stat } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { readJson, writeJson } from './jsonFile'
import { PROVIDER_IDS } from '../shared/providers'
import type {
  PrRef,
  ProviderId,
  PullRequest,
  RecentReview,
  ReviewState,
  TeamLessons,
  TourRecord,
} from '../shared/types'

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

  loadReview(ref: PrRef, headSha: string): Promise<ReviewState | null> {
    return readJson<ReviewState>(this.reviewPath(ref, headSha))
  }

  saveReview(state: ReviewState): void {
    writeJson(this.reviewPath(state.pr, state.headSha), state)
  }

  async latestOtherReview(ref: PrRef, headSha: string): Promise<ReviewState | null> {
    const names = await readdir(this.prDir(ref)).catch(() => [])
    const candidates = await Promise.all(
      names
        .filter((name) => name.endsWith('.review.json') && !name.startsWith(headSha))
        .map(async (name) => ({ name, modified: (await stat(join(this.prDir(ref), name))).mtimeMs })),
    )
    const latest = candidates.sort((a, b) => b.modified - a.modified)[0]
    return latest ? readJson<ReviewState>(join(this.prDir(ref), latest.name)) : null
  }

  loadLessons(ref: PrRef): Promise<TeamLessons | null> {
    return readJson<TeamLessons>(join(this.repoDir(ref), 'lessons.json'))
  }

  saveLessons(ref: PrRef, lessons: TeamLessons): void {
    writeJson(join(this.repoDir(ref), 'lessons.json'), lessons)
  }

  recordOpened(pr: PullRequest): void {
    const entry: RecentReview = { ref: pr.ref, url: pr.url, title: pr.title, openedAt: new Date().toISOString() }
    writeJson(join(this.prDir(pr.ref), 'opened.json'), entry)
  }

  async recentReviews(limit: number): Promise<RecentReview[]> {
    const root = join(this.dataDir, 'reviews')
    const paths = await readdir(root, { recursive: true }).catch(() => [])
    const entries = await Promise.all(
      paths
        .filter((path) => path.endsWith(`${sep}opened.json`))
        .map((path) => readJson<RecentReview>(join(root, path))),
    )
    return entries
      .filter((entry) => entry !== null)
      .sort((a, b) => b.openedAt.localeCompare(a.openedAt))
      .slice(0, limit)
  }

  private repoDir(ref: PrRef): string {
    return join(this.dataDir, 'reviews', ref.owner, ref.repo)
  }

  private prDir(ref: PrRef): string {
    return join(this.repoDir(ref), String(ref.number))
  }

  private tourPath(ref: PrRef, headSha: string, provider: ProviderId): string {
    return join(this.prDir(ref), `${headSha}.tour.${provider}.json`)
  }

  private reviewPath(ref: PrRef, headSha: string): string {
    return join(this.prDir(ref), `${headSha}.review.json`)
  }
}
