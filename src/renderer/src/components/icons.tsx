import type { ReactNode } from 'react'

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export const BackIcon = () => (
  <Icon>
    <path d="M10 3.5 5.5 8l4.5 4.5" />
  </Icon>
)

export const SettingsIcon = () => (
  <Icon>
    <path d="M2.5 4.5h6m3 0h2m-11 7h2m3 0h6" />
    <circle cx="10" cy="4.5" r="1.5" />
    <circle cx="6" cy="11.5" r="1.5" />
  </Icon>
)

export const CheckIcon = () => (
  <Icon>
    <path d="m3.5 8.5 3 3 6-7" />
  </Icon>
)

export const CloseIcon = () => (
  <Icon>
    <path d="m4 4 8 8m0-8-8 8" />
  </Icon>
)

export const ExternalIcon = () => (
  <Icon>
    <path d="M9.5 2.5h4v4m0-4L8 8m3.5 1.5v4h-9v-9h4" />
  </Icon>
)

export const AskIcon = () => (
  <Icon>
    <path d="M2.5 3.5h11v7.5H7.5l-3 2.5V11h-2z" />
  </Icon>
)
