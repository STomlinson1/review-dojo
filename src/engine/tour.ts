import { z } from 'zod'
import { closeTruncatedJson, parseModelJson } from './json'
import { selectHunks, tourStops } from '../shared/tour'
import type { AgentEvent, Chapter, CodeLocation, Diff, Hunk, Risk, Stop, TaskEvent, Tour } from '../shared/types'

// Plain numbers: `.int()` emits safe-integer bounds, which Anthropic's schema subset rejects.
const location = {
  path: z.string(),
  startLine: z.number(),
  endLine: z.number(),
}

/**
 * The shape agents return. Every property is required and objects are closed so the schema is
 * valid for OpenAI strict structured outputs as well as Anthropic's.
 */
export const rawTourSchema = z.strictObject({
  summary: z.string(),
  intent: z.strictObject({
    stated: z.array(z.string()),
    claims: z.array(
      z.strictObject({
        claim: z.string(),
        status: z.enum(['delivered', 'partial', 'missing']),
        evidence: z.string(),
      }),
    ),
    unexplained: z.array(z.strictObject({ description: z.string(), hunkIds: z.array(z.string()) })),
  }),
  chapters: z.array(
    z.strictObject({
      title: z.string(),
      goal: z.string(),
      stops: z.array(
        z.strictObject({
          title: z.string(),
          hunkIds: z.array(z.string()),
          explanation: z.string(),
          risk: z.enum(['low', 'medium', 'high']),
          riskReason: z.string(),
          checks: z.array(z.string()),
          context: z.array(z.strictObject({ ...location, why: z.string() })),
          conventions: z.array(
            z.strictObject({
              observation: z.string(),
              precedents: z.array(z.strictObject(location)),
            }),
          ),
          question: z.strictObject({ prompt: z.string(), answer: z.string() }).nullable(),
        }),
      ),
    }),
  ),
})

export type RawTour = z.infer<typeof rawTourSchema>

const { $schema: _dialect, ...tourJsonSchemaBody } = z.toJSONSchema(rawTourSchema, { target: 'draft-7' })
export const tourJsonSchema: Record<string, unknown> = tourJsonSchemaBody

const UNCOVERED_EXPLANATION =
  "The tour didn't place these changes in any stop. Read them directly and make sure they belong in this PR."

const chapterDraftSchema = z.object({ title: z.string(), goal: z.string(), stops: z.array(z.unknown()) })
const tourDraftSchema = z.object({ summary: z.string(), chapters: z.array(z.unknown()).default([]) })
const stopSchema = rawTourSchema.shape.chapters.element.shape.stops.element

/** The fully written part of a tour the agent is still writing, or null before it says anything usable. */
export function partialTour(text: string, diff: Diff): Tour | null {
  const closed = closeTruncatedJson(text)
  if (!closed) return null
  let value: unknown
  try {
    value = parseModelJson(closed)
  } catch {
    return null
  }
  const draft = tourDraftSchema.safeParse(value)
  if (!draft.success) return null
  const intent = rawTourSchema.shape.intent.safeParse((value as { intent?: unknown }).intent)
  const chapters = draft.data.chapters.flatMap((entry) => {
    const chapter = chapterDraftSchema.safeParse(entry)
    if (!chapter.success) return []
    const stops = chapter.data.stops.flatMap((stop) => {
      const parsed = stopSchema.safeParse(stop)
      return parsed.success ? [parsed.data] : []
    })
    return stops.length > 0 ? [{ ...chapter.data, stops }] : []
  })
  const raw: RawTour = {
    summary: draft.data.summary,
    intent: intent.success ? intent.data : { stated: [], claims: [], unexplained: [] },
    chapters,
  }
  return normalizeTour(raw, diff, { coverLeftovers: false })
}

/** Every hunk the agent leaves unclaimed lands in a trailing chapter so nothing in the diff escapes review. */
export function normalizeTour(raw: RawTour, diff: Diff, { coverLeftovers = true } = {}): Tour {
  const hunks = new Map(diff.files.flatMap((file) => file.hunks.map((hunk) => [hunk.id, hunk])))
  const claimed = new Set<string>()
  let stopCount = 0
  const nextStopId = () => `S${(stopCount += 1)}`

  const chapters: Chapter[] = []
  for (const rawChapter of raw.chapters) {
    const stops: Stop[] = []
    for (const rawStop of rawChapter.stops) {
      const hunkIds = rawStop.hunkIds.filter((id) => hunks.has(id) && !claimed.has(id))
      hunkIds.forEach((id) => claimed.add(id))
      if (hunkIds.length === 0 && rawStop.context.length === 0) continue
      stops.push({
        ...rawStop,
        id: nextStopId(),
        hunkIds,
        context: rawStop.context.map((ref) => ({ ...clampLocation(ref), why: ref.why })),
        conventions: rawStop.conventions.map((note) => ({
          observation: note.observation,
          precedents: note.precedents.map(clampLocation),
        })),
      })
    }
    if (stops.length > 0) {
      chapters.push({ id: `C${chapters.length + 1}`, title: rawChapter.title, goal: rawChapter.goal, stops })
    }
  }

  const leftovers = coverLeftovers ? selectHunks(diff, (hunk) => !claimed.has(hunk.id)) : []

  const uncovered = leftovers.filter((entry) => !entry.file.isGenerated)
  if (uncovered.length > 0) {
    chapters.push({
      id: `C${chapters.length + 1}`,
      title: 'Not covered by the tour',
      goal: 'Changes the guide skipped. Review each one directly.',
      stops: uncovered.map(({ file, hunks: fileHunks }) =>
        fallbackStop(nextStopId(), file.path, fileHunks, UNCOVERED_EXPLANATION, 'medium', 'Not analyzed by the guide.'),
      ),
    })
  }

  const generated = leftovers.filter((entry) => entry.file.isGenerated)
  if (generated.length > 0) {
    chapters.push({
      id: `C${chapters.length + 1}`,
      title: 'Generated files and lockfiles',
      goal: 'Machine-written changes. Skim for unexpected additions.',
      stops: [
        fallbackStop(
          nextStopId(),
          'Generated files',
          generated.flatMap((entry) => entry.hunks),
          `Generated or lockfile changes in ${generated.map((entry) => `\`${entry.file.path}\``).join(', ')}.`,
          'low',
          'Generated content.',
        ),
      ],
    })
  }

  return {
    summary: raw.summary,
    intent: {
      stated: raw.intent.stated,
      claims: raw.intent.claims,
      unexplained: raw.intent.unexplained.map((item) => ({
        description: item.description,
        hunkIds: item.hunkIds.filter((id) => hunks.has(id)),
      })),
    },
    chapters,
  }
}

function fallbackStop(
  id: string,
  title: string,
  hunks: Hunk[],
  explanation: string,
  risk: Risk,
  riskReason: string,
): Stop {
  return {
    id,
    title,
    hunkIds: hunks.map((hunk) => hunk.id),
    explanation,
    risk,
    riskReason,
    checks: [],
    context: [],
    conventions: [],
    question: null,
  }
}

function clampLocation(location: CodeLocation): CodeLocation {
  const startLine = Math.max(1, Math.trunc(location.startLine))
  return { path: location.path, startLine, endLine: Math.max(startLine, Math.trunc(location.endLine)) }
}

/** A preview goes out only when another stop has become readable, never for the same or fewer stops. */
export function previewTour(diff: Diff, onEvent: (event: TaskEvent) => void): (event: AgentEvent) => void {
  let readableStops = -1
  return (event) => {
    if (event.kind !== 'draft') return onEvent(event)
    const tour = partialTour(event.text, diff)
    const stops = tour ? tourStops(tour).length : -1
    if (!tour || stops <= readableStops) return
    readableStops = stops
    onEvent({ kind: 'tour', tour })
  }
}
