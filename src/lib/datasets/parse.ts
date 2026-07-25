import { AppError } from '@/lib/core/errors';
import type { DatasetFormat } from '@/lib/db/models';

/**
 * Dataset parsing for batch evaluation.
 *
 * Supports CSV, JSON and JSONL. All three normalise to the same shape: an
 * ordered column list plus rows of `column -> string`. Everything is coerced to
 * a string because values are destined for prompt-variable substitution, where
 * a number and its rendering are indistinguishable.
 */

export interface ParsedDataset {
  columns: string[];
  rows: Array<Record<string, string>>;
  /** Non-fatal problems worth surfacing to the user after import. */
  warnings: string[];
}

export function parseDataset(
  content: string,
  format: DatasetFormat,
  options?: { maxRows?: number },
): ParsedDataset {
  const maxRows = options?.maxRows ?? 10_000;

  const parsed =
    format === 'csv'
      ? parseCsv(content)
      : format === 'jsonl'
        ? parseJsonl(content)
        : parseJson(content);

  if (parsed.rows.length === 0) {
    throw new AppError('validation_failed', 'The dataset contains no rows.');
  }

  if (parsed.rows.length > maxRows) {
    parsed.warnings.push(
      `Dataset truncated from ${parsed.rows.length} to ${maxRows} rows.`,
    );
    parsed.rows = parsed.rows.slice(0, maxRows);
  }

  return parsed;
}

/**
 * RFC 4180 CSV parser.
 *
 * Hand-written rather than pulled from a dependency because the requirement is
 * narrow and the correctness-critical cases — quoted fields containing commas,
 * newlines, and escaped quotes — are exactly the cases naive `split(',')`
 * implementations get wrong and silently corrupt data on.
 */
export function parseCsv(content: string): ParsedDataset {
  const warnings: string[] = [];
  const records = tokeniseCsv(content.replace(/^﻿/, ''));

  if (records.length === 0) {
    throw new AppError('validation_failed', 'The CSV file is empty.');
  }

  const header = records[0]!;
  const columns = header.map((name, index) => {
    const trimmed = name.trim();
    return trimmed || `column_${index + 1}`;
  });

  const seen = new Set<string>();
  columns.forEach((name, index) => {
    if (seen.has(name)) {
      const unique = `${name}_${index + 1}`;
      warnings.push(`Duplicate column "${name}" renamed to "${unique}".`);
      columns[index] = unique;
    }
    seen.add(columns[index]!);
  });

  const rows: Array<Record<string, string>> = [];

  for (let i = 1; i < records.length; i++) {
    const record = records[i]!;
    // A trailing newline yields a final single-empty-field record; skip it.
    if (record.length === 1 && record[0]!.trim() === '') continue;

    if (record.length !== columns.length) {
      warnings.push(
        `Row ${i + 1} has ${record.length} fields but the header declares ${columns.length}.`,
      );
    }

    const row: Record<string, string> = {};
    columns.forEach((column, index) => {
      row[column] = record[index] ?? '';
    });
    rows.push(row);
  }

  return { columns, rows, warnings };
}

/** Splits CSV text into records of fields, honouring quoting rules. */
function tokeniseCsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;

    if (inQuotes) {
      if (char === '"') {
        // A doubled quote inside a quoted field is a literal quote.
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      record.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      // Consume CRLF as a single terminator.
      if (char === '\r' && text[i + 1] === '\n') i++;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else {
      field += char;
    }
  }

  // Flush whatever the final line left buffered.
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  return records;
}

export function parseJson(content: string): ParsedDataset {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new AppError(
      'validation_failed',
      `Invalid JSON: ${error instanceof Error ? error.message : 'parse failed'}`,
    );
  }

  // Accept both a bare array and the common `{ "rows": [...] }` / `{ "data": [...] }`
  // envelopes, since exported datasets use all three shapes.
  const array = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.rows)
      ? parsed.rows
      : isRecord(parsed) && Array.isArray(parsed.data)
        ? parsed.data
        : null;

  if (!array) {
    throw new AppError(
      'validation_failed',
      'JSON datasets must be an array of objects, or an object with a `rows` or `data` array.',
    );
  }

  return normaliseObjects(array);
}

export function parseJsonl(content: string): ParsedDataset {
  const warnings: string[] = [];
  const objects: unknown[] = [];

  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      objects.push(JSON.parse(trimmed));
    } catch {
      warnings.push(`Line ${index + 1} is not valid JSON and was skipped.`);
    }
  });

  if (objects.length === 0) {
    throw new AppError(
      'validation_failed',
      'No valid JSON objects found in the JSONL file.',
    );
  }

  const result = normaliseObjects(objects);
  return { ...result, warnings: [...warnings, ...result.warnings] };
}

/**
 * Flattens a heterogeneous array of objects into a rectangular table.
 *
 * The column set is the union across all rows, in first-seen order, so a row
 * that omits a field yields an empty string rather than dropping the column.
 */
function normaliseObjects(items: unknown[]): ParsedDataset {
  const warnings: string[] = [];
  const columns: string[] = [];
  const seen = new Set<string>();
  const rows: Array<Record<string, string>> = [];

  items.forEach((item, index) => {
    if (!isRecord(item)) {
      warnings.push(`Item ${index + 1} is not an object and was skipped.`);
      return;
    }

    const row: Record<string, string> = {};
    for (const [key, value] of Object.entries(item)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
      row[key] = stringify(value);
    }
    rows.push(row);
  });

  // Backfill so every row has every column.
  for (const row of rows) {
    for (const column of columns) row[column] ??= '';
  }

  return { columns, rows, warnings };
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  // Nested structures are preserved as JSON rather than becoming "[object Object]".
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Infers the format from a filename, defaulting to CSV. */
export function formatFromFilename(filename: string): DatasetFormat {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.jsonl') || lower.endsWith('.ndjson')) return 'jsonl';
  if (lower.endsWith('.json')) return 'json';
  return 'csv';
}

/**
 * Maps dataset columns onto the variables a template declares, reporting which
 * variables the dataset cannot satisfy. Surfaced before a run so a mismatch is
 * caught before any spend.
 */
export function matchColumnsToVariables(
  columns: string[],
  variableNames: string[],
): { matched: string[]; unmatched: string[] } {
  const available = new Set(columns);
  const matched = variableNames.filter((name) => available.has(name));
  const unmatched = variableNames.filter((name) => !available.has(name));
  return { matched, unmatched };
}
