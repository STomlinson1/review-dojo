import { z } from 'zod'
import { selectHunks } from '../shared/tour'
import type { Chapter, CodeLocation, Diff, Hunk, Risk, Stop, Tour } from '../shared/types'

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

/** Every hunk the agent leaves unclaimed lands in a trailing chapter so nothing in the diff escapes review. */
export function normalizeTour(raw: RawTour, diff: Diff): Tour {
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

  const leftovers = selectHunks(diff, (hunk) => !claimed.has(hunk.id))

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
