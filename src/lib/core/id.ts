import { customAlphabet } from 'nanoid';

/**
 * Prefixed, URL-safe identifiers.
 *
 * The prefix makes ids self-describing in logs and API responses, which is
 * worth far more during debugging than the handful of bytes it costs. The
 * alphabet omits look-alike characters so ids survive being read aloud or
 * transcribed from a screenshot.
 */
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const generate = customAlphabet(ALPHABET, 20);

export type IdPrefix =
  | 'ws'
  | 'user'
  | 'prompt'
  | 'ver'
  | 'bench'
  | 'run'
  | 'row'
  | 'ds'
  | 'eval'
  | 'key'
  | 'cmt'
  | 'rpt';

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${generate()}`;
}

const ID_PATTERN = /^[a-z]{2,6}_[0-9abcdefghjkmnpqrstvwxyz]{20}$/;

export function isValidId(value: string, prefix?: IdPrefix): boolean {
  if (!ID_PATTERN.test(value)) return false;
  return prefix ? value.startsWith(`${prefix}_`) : true;
}
