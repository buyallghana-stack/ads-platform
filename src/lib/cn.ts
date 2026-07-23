import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merge class names, letting later Tailwind utilities win over earlier ones.
 * Without twMerge, `cn('p-2', 'p-4')` emits both and the winner depends on
 * stylesheet order rather than call order.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
