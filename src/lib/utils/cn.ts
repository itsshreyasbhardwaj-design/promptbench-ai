import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merges class names, resolving Tailwind conflicts so the last value wins.
 *
 * Without `twMerge`, a component that hardcodes `px-4` and a caller that passes
 * `px-6` produce both classes and the winner depends on stylesheet order rather
 * than intent. This makes overrides predictable, which is what allows every
 * primitive below to accept a `className`.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
