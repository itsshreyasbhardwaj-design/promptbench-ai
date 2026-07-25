import { AppError } from '@/lib/core/errors';

/**
 * Prompt templating.
 *
 * Syntax is deliberately minimal: `{{variable}}`, optionally with a default via
 * `{{variable|fallback text}}`. No loops, no conditionals, no expression
 * evaluation — a prompt template is content, and giving it a runtime would turn
 * user-authored strings into an injection surface for no real benefit.
 */

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:\|([^}]*))?\}\}/g;

/** Guards against a pathological template exploding memory during render. */
const MAX_RENDERED_LENGTH = 500_000;

export interface TemplateVariable {
  name: string;
  defaultValue: string | null;
  /** Number of times the variable appears in the template. */
  occurrences: number;
}

/** Extracts the distinct variables declared in a template, in first-use order. */
export function extractVariables(template: string): TemplateVariable[] {
  const found = new Map<string, TemplateVariable>();

  for (const match of template.matchAll(VARIABLE_PATTERN)) {
    const name = match[1]!;
    const fallback = match[2];
    const existing = found.get(name);

    if (existing) {
      existing.occurrences += 1;
      // First declared default wins; later occurrences may omit it.
      existing.defaultValue ??= fallback ?? null;
    } else {
      found.set(name, {
        name,
        defaultValue: fallback ?? null,
        occurrences: 1,
      });
    }
  }

  return [...found.values()];
}

export interface RenderOptions {
  /** Throw when a variable has neither a supplied value nor a default. */
  strict?: boolean;
}

export interface RenderResult {
  text: string;
  /** Variables that fell back to their default value. */
  defaulted: string[];
  /** Variables with no value and no default, left as an empty string. */
  missing: string[];
}

/**
 * Substitutes values into a template.
 *
 * Values are inserted literally — no escaping, no re-scanning — so a value that
 * itself contains `{{x}}` is treated as text rather than expanded. That closes
 * the obvious recursive-expansion hole when variables come from an untrusted
 * dataset row.
 */
export function renderTemplate(
  template: string,
  values: Record<string, string> = {},
  options: RenderOptions = {},
): RenderResult {
  const defaulted: string[] = [];
  const missing: string[] = [];

  const text = template.replace(
    VARIABLE_PATTERN,
    (_match, rawName: string, fallback?: string) => {
      const name = rawName.trim();
      const supplied = values[name];

      if (supplied !== undefined && supplied !== '') return supplied;
      if (fallback !== undefined) {
        defaulted.push(name);
        return fallback;
      }
      missing.push(name);
      return '';
    },
  );

  if (options.strict && missing.length > 0) {
    throw new AppError(
      'validation_failed',
      `Template is missing required variable${missing.length > 1 ? 's' : ''}: ${[
        ...new Set(missing),
      ].join(', ')}`,
      { details: { missing: [...new Set(missing)] } },
    );
  }

  if (text.length > MAX_RENDERED_LENGTH) {
    throw new AppError(
      'payload_too_large',
      `Rendered prompt exceeds ${MAX_RENDERED_LENGTH.toLocaleString()} characters.`,
    );
  }

  return { text, defaulted: [...new Set(defaulted)], missing: [...new Set(missing)] };
}

/** Convenience wrapper for callers that only need the string. */
export function render(template: string, values: Record<string, string> = {}): string {
  return renderTemplate(template, values).text;
}

/**
 * Reports whether a set of values fully satisfies a template — used to enable
 * or disable the run button before anything is dispatched.
 */
export function validateVariables(
  template: string,
  values: Record<string, string>,
): { valid: boolean; missing: string[] } {
  const missing = extractVariables(template)
    .filter((v) => v.defaultValue === null && !values[v.name])
    .map((v) => v.name);
  return { valid: missing.length === 0, missing };
}
