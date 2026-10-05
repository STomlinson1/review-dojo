import type { Chapter, Stop, Tour } from '../../src/shared/types'
import type { FixturePr } from './remotes'

/** What a model returns: a tour before the app has given its chapters and stops their ids. */
export type ScriptedStop = Omit<Stop, 'id'>
export type ScriptedChapter = Omit<Chapter, 'id' | 'stops'> & { stops: ScriptedStop[] }
export type ScriptedTour = Omit<Tour, 'chapters'> & { chapters: ScriptedChapter[] }

export function stop(title: string, hunkIds: string[], extra: Partial<ScriptedStop> = {}): ScriptedStop {
  return {
    title,
    hunkIds,
    explanation: `${title}: what changed and why.`,
    risk: 'low',
    riskReason: 'Small and local.',
    checks: [],
    context: [],
    conventions: [],
    question: null,
    ...extra,
  }
}

export function widgetTour(
  pr: FixturePr,
  summary = 'Greetings gain an exclamation mark and a farewell.',
): ScriptedTour {
  return {
    summary,
    intent: {
      stated: ['Add an exclamation mark to greetings', 'Add a farewell helper'],
      claims: [
        { claim: 'Greetings end with an exclamation mark', status: 'delivered', evidence: 'See `src/greet.ts:3`.' },
      ],
      unexplained: [{ description: 'A `double` helper nobody asked for.', hunkIds: pr.hunks['src/util/math.ts'] }],
    },
    chapters: [
      {
        title: 'Greeting',
        goal: 'How a greeting is built.',
        stops: [
          stop('Friendlier greeting', pr.hunks['src/greet.ts'], {
            explanation: 'The greeting now ends with an exclamation mark. Compare `src/util/math.ts:2`.',
            risk: 'medium',
            riskReason: 'Every caller sees the new text.',
            checks: ['Confirm `shout` still upper-cases the name', 'Confirm no caller appends its own punctuation'],
            context: [{ path: 'README.md', startLine: 1, endLine: 3, why: 'Describes the helpers.' }],
            question: { prompt: 'What does `greet(" Ada ")` return now?', answer: '`Hello, Ada!`' },
          }),
        ],
      },
      {
        title: 'Helpers',
        goal: 'The new helpers around the greeting.',
        stops: [
          stop('Farewell helper', pr.hunks['src/farewell.ts'], {
            risk: 'high',
            riskReason: 'Rewrites the greeting text by string replacement.',
          }),
          stop('Double helper', pr.hunks['src/util/math.ts']),
        ],
      },
    ],
  }
}
