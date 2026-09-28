import type { Risk } from '../../../shared/types'
import styles from './Risk.module.css'

export function RiskDot({ risk }: { risk: Risk }) {
  return <span className={styles.dot} data-risk={risk} role="img" aria-label={`${risk} risk`} />
}

export function RiskBadge({ risk }: { risk: Risk }) {
  return (
    <span className={styles.badge} data-risk={risk}>
      {risk} risk
    </span>
  )
}
