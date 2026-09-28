import type { CodeLocation } from '../../../shared/types'

const CODE_REF = /^\.?\/?([\w.@/-]+):(\d+)(?:[-–](\d+))?$/

export function parseCodeRef(text: string): CodeLocation | null {
  const match = CODE_REF.exec(text.trim())
  if (!match || !/[./]/.test(match[1]) || !/[a-z]/i.test(match[1])) return null
  const startLine = Number(match[2])
  const endLine = match[3] ? Number(match[3]) : startLine
  return { path: match[1], startLine, endLine: Math.max(startLine, endLine) }
}

export function formatLocation(location: CodeLocation): string {
  return location.startLine === location.endLine
    ? `${location.path}:${location.startLine}`
    : `${location.path}:${location.startLine}-${location.endLine}`
}
