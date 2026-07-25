import { describe, expect, it } from 'vitest';
import {
  extractVariables,
  render,
  renderTemplate,
  validateVariables,
} from '@/lib/prompts/template';
import { diffLines, diffStats } from '@/lib/prompts/diff';
import { AppError } from '@/lib/core/errors';

describe('extractVariables', () => {
  it('finds variables in first-use order', () => {
    const variables = extractVariables('{{b}} then {{a}} then {{b}}');
    expect(variables.map((v) => v.name)).toEqual(['b', 'a']);
  });

  it('counts repeat occurrences', () => {
    const [first] = extractVariables('{{x}} {{x}} {{x}}');
    expect(first?.occurrences).toBe(3);
  });

  it('captures default values', () => {
    const [variable] = extractVariables('{{tone|professional}}');
    expect(variable?.defaultValue).toBe('professional');
  });

  it('keeps the first declared default when later uses omit it', () => {
    const [variable] = extractVariables('{{tone|formal}} and {{tone}}');
    expect(variable?.defaultValue).toBe('formal');
  });

  it('tolerates whitespace inside the braces', () => {
    expect(extractVariables('{{  spaced  }}').map((v) => v.name)).toEqual(['spaced']);
  });

  it('ignores malformed placeholders', () => {
    expect(extractVariables('{single} {{ }} {{123bad}}')).toEqual([]);
  });
});

describe('renderTemplate', () => {
  it('substitutes supplied values', () => {
    expect(render('Hello {{name}}', { name: 'Ada' })).toBe('Hello Ada');
  });

  it('replaces every occurrence', () => {
    expect(render('{{x}}-{{x}}-{{x}}', { x: 'a' })).toBe('a-a-a');
  });

  it('falls back to the default and reports it', () => {
    const result = renderTemplate('Tone: {{tone|neutral}}', {});
    expect(result.text).toBe('Tone: neutral');
    expect(result.defaulted).toEqual(['tone']);
  });

  it('prefers a supplied value over the default', () => {
    expect(render('{{tone|neutral}}', { tone: 'warm' })).toBe('warm');
  });

  it('treats an empty string as absent so the default still applies', () => {
    expect(render('{{tone|neutral}}', { tone: '' })).toBe('neutral');
  });

  it('renders missing variables as empty and reports them', () => {
    const result = renderTemplate('A{{missing}}B', {});
    expect(result.text).toBe('AB');
    expect(result.missing).toEqual(['missing']);
  });

  it('throws in strict mode when a required variable has no value', () => {
    expect(() => renderTemplate('{{a}}', {}, { strict: true })).toThrow(AppError);
  });

  it('does not re-expand placeholders that appear inside a value', () => {
    // Dataset rows are untrusted input; a value containing template syntax must
    // be inserted literally rather than triggering another substitution pass.
    const result = renderTemplate('{{outer}}', { outer: '{{inner}}', inner: 'PWNED' });
    expect(result.text).toBe('{{inner}}');
    expect(result.text).not.toContain('PWNED');
  });

  it('rejects a render that would exceed the length ceiling', () => {
    const huge = 'x'.repeat(600_000);
    expect(() => renderTemplate('{{v}}', { v: huge })).toThrow(/exceeds/i);
  });

  it('leaves a template with no variables untouched', () => {
    expect(render('plain text', { unused: 'x' })).toBe('plain text');
  });
});

describe('validateVariables', () => {
  it('passes when every required variable has a value', () => {
    expect(validateVariables('{{a}} {{b}}', { a: '1', b: '2' })).toEqual({
      valid: true,
      missing: [],
    });
  });

  it('does not require variables that declare a default', () => {
    expect(validateVariables('{{a|x}}', {}).valid).toBe(true);
  });

  it('lists the variables that block a run', () => {
    expect(validateVariables('{{a}} {{b|d}}', {}).missing).toEqual(['a']);
  });
});

describe('diffLines', () => {
  it('marks identical text as entirely unchanged', () => {
    const diff = diffLines('a\nb', 'a\nb');
    expect(diff.every((line) => line.op === 'equal')).toBe(true);
  });

  it('detects an inserted line without misaligning the rest', () => {
    // A greedy line-by-line walk would mark everything after the insert as
    // changed. LCS keeps the shared lines aligned.
    const diff = diffLines('a\nb\nc', 'a\nNEW\nb\nc');
    const stats = diffStats(diff);

    expect(stats.added).toBe(1);
    expect(stats.removed).toBe(0);
    expect(stats.unchanged).toBe(3);
  });

  it('detects a deleted line', () => {
    const stats = diffStats(diffLines('a\nb\nc', 'a\nc'));
    expect(stats.removed).toBe(1);
    expect(stats.added).toBe(0);
  });

  it('reports a replacement as one delete plus one insert', () => {
    const stats = diffStats(diffLines('a\nOLD\nc', 'a\nNEW\nc'));
    expect(stats.added).toBe(1);
    expect(stats.removed).toBe(1);
    expect(stats.unchanged).toBe(2);
  });

  it('assigns line numbers only on the side a line exists', () => {
    const diff = diffLines('a', 'a\nb');
    const inserted = diff.find((line) => line.op === 'insert');

    expect(inserted?.oldLine).toBeNull();
    expect(inserted?.newLine).toBe(2);
  });

  it('handles an empty original', () => {
    expect(diffStats(diffLines('', 'a\nb')).added).toBe(2);
  });
});
