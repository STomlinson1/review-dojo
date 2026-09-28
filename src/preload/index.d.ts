import type { DojoApi } from '../shared/types'

declare global {
  interface Window {
    dojo: DojoApi
  }
}
