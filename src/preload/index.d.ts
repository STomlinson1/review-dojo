import type { DocentApi } from '../shared/types'

declare global {
  interface Window {
    docent: DocentApi
  }
}
