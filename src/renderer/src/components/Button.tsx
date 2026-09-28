import type { ButtonHTMLAttributes } from 'react'
import styles from './Button.module.css'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
}

export function Button({ variant = 'secondary', size = 'md', type = 'button', className, ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={className ? `${styles.button} ${className}` : styles.button}
      data-variant={variant}
      data-size={size}
      {...props}
    />
  )
}
