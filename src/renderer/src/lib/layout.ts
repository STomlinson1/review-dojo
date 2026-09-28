export type Layout = 'focus' | 'side-by-side'

const STORAGE_KEY = 'reviewDojo.layout'
const SIDE_BY_SIDE_DEFAULT_WIDTH = 1400
export const SIDE_BY_SIDE_MIN_WIDTH = 1200

export const sideBySideFits = window.matchMedia(`(min-width: ${SIDE_BY_SIDE_MIN_WIDTH}px)`)

export function initialLayout(): Layout {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'focus' || stored === 'side-by-side') return stored
  } catch {
    // Storage can be unavailable; the width-based default still applies.
  }
  return window.innerWidth >= SIDE_BY_SIDE_DEFAULT_WIDTH ? 'side-by-side' : 'focus'
}

export function rememberLayout(layout: Layout): void {
  try {
    localStorage.setItem(STORAGE_KEY, layout)
  } catch {
    // The choice then lasts only for this session.
  }
}
