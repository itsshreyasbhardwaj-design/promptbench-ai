import { describe, expect, it } from 'vitest';
import {
  formatFromFilename,
  matchColumnsToVariables,
  parseCsv,
  parseDataset,
  parseJson,
  parseJsonl,
} from '@/lib/datasets/parse';

describe('parseCsv', () => {
  it('parses a simple table', () => {
    const result = parseCsv('a,b\n1,2\n3,4');
    expect(result.columns).toEqual(['a', 'b']);
    expect(result.rows).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);
  });

  it('keeps commas inside quoted fields', () => {
    // The case naive split(',') corrupts silently.
    const result = parseCsv('name,note\n"Smith, John",ok');
    expect(result.rows[0]).toEqual({ name: 'Smith, John', note: 'ok' });
  });

  it('keeps newlines inside quoted fields', () => {
    const result = parseCsv('a,b\n"line one\nline two",x');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.a).toBe('line one\nline two');
  });

  it('unescapes doubled quotes', () => {
    const result = parseCsv('a\n"He said ""hi"""');
    expect(result.rows[0]?.a).toBe('He said "hi"');
  });

  it('handles CRLF line endings', () => {
    const result = parseCsv('a,b\r\n1,2\r\n3,4');
    expect(result.rows).toHaveLength(2);
    expect(result.rows[1]).toEqual({ a: '3', b: '4' });
  });

  it('ignores a trailing newline rather than emitting a blank row', () => {
    expect(parseCsv('a\n1\n').rows).toHaveLength(1);
  });

  it('strips a UTF-8 BOM from the first header', () => {
    const result = parseCsv('﻿name,value\nx,1');
    expect(result.columns).toEqual(['name', 'value']);
  });

  it('renames duplicate columns and warns', () => {
    const result = parseCsv('a,a\n1,2');
    expect(result.columns).toEqual(['a', 'a_2']);
    expect(result.warnings.some((w) => /duplicate/i.test(w))).toBe(true);
  });

  it('names blank headers positionally', () => {
    expect(parseCsv('a,,c\n1,2,3').columns).toEqual(['a', 'column_2', 'c']);
  });

  it('warns when a row field count disagrees with the header', () => {
    const result = parseCsv('a,b,c\n1,2');
    expect(result.warnings.some((w) => w.includes('Row 2'))).toBe(true);
    expect(result.rows[0]?.c).toBe('');
  });

  it('throws on an empty file', () => {
    expect(() => parseCsv('')).toThrow();
  });
});

describe('parseJson', () => {
  it('parses a bare array of objects', () => {
    const result = parseJson('[{"a":1},{"a":2}]');
    expect(result.columns).toEqual(['a']);
    expect(result.rows).toEqual([{ a: '1' }, { a: '2' }]);
  });

  it('accepts a rows envelope', () => {
    expect(parseJson('{"rows":[{"a":1}]}').rows).toHaveLength(1);
  });

  it('accepts a data envelope', () => {
    expect(parseJson('{"data":[{"a":1}]}').rows).toHaveLength(1);
  });

  it('unions columns across heterogeneous rows and backfills gaps', () => {
    const result = parseJson('[{"a":1},{"b":2}]');
    expect(result.columns).toEqual(['a', 'b']);
    expect(result.rows[0]).toEqual({ a: '1', b: '' });
    expect(result.rows[1]).toEqual({ a: '', b: '2' });
  });

  it('serialises nested values as JSON rather than [object Object]', () => {
    const result = parseJson('[{"meta":{"k":1}}]');
    expect(result.rows[0]?.meta).toBe('{"k":1}');
  });

  it('renders null as an empty string', () => {
    expect(parseJson('[{"a":null}]').rows[0]?.a).toBe('');
  });

  it('reports the parse error on malformed JSON', () => {
    expect(() => parseJson('{not json')).toThrow(/Invalid JSON/);
  });

  it('rejects a shape that is not an array of objects', () => {
    expect(() => parseJson('{"a":1}')).toThrow(/array of objects/);
  });
});

describe('parseJsonl', () => {
  it('parses one object per line', () => {
    expect(parseJsonl('{"a":1}\n{"a":2}').rows).toHaveLength(2);
  });

  it('skips blank lines', () => {
    expect(parseJsonl('{"a":1}\n\n\n{"a":2}\n').rows).toHaveLength(2);
  });

  it('skips a malformed line and warns rather than failing the import', () => {
    const result = parseJsonl('{"a":1}\nNOT JSON\n{"a":2}');
    expect(result.rows).toHaveLength(2);
    expect(result.warnings.some((w) => w.includes('Line 2'))).toBe(true);
  });

  it('throws when no line is valid', () => {
    expect(() => parseJsonl('nope\nalso nope')).toThrow();
  });
});

describe('parseDataset', () => {
  it('dispatches on the declared format', () => {
    expect(parseDataset('a\n1', 'csv').rows).toHaveLength(1);
    expect(parseDataset('[{"a":1}]', 'json').rows).toHaveLength(1);
    expect(parseDataset('{"a":1}', 'jsonl').rows).toHaveLength(1);
  });

  it('truncates past the row ceiling and says so', () => {
    const rows = Array.from({ length: 20 }, (_, i) => `{"a":${i}}`).join('\n');
    const result = parseDataset(rows, 'jsonl', { maxRows: 5 });

    expect(result.rows).toHaveLength(5);
    expect(result.warnings.some((w) => /truncated/i.test(w))).toBe(true);
  });

  it('throws when the file parses to no rows', () => {
    expect(() => parseDataset('a,b', 'csv')).toThrow(/no rows/i);
  });
});

describe('formatFromFilename', () => {
  it('recognises each extension and defaults to csv', () => {
    expect(formatFromFilename('cases.jsonl')).toBe('jsonl');
    expect(formatFromFilename('cases.ndjson')).toBe('jsonl');
    expect(formatFromFilename('cases.JSON')).toBe('json');
    expect(formatFromFilename('cases.csv')).toBe('csv');
    expect(formatFromFilename('cases.txt')).toBe('csv');
  });
});

describe('matchColumnsToVariables', () => {
  it('separates satisfied variables from unsatisfied ones', () => {
    const result = matchColumnsToVariables(
      ['question', 'expected'],
      ['question', 'context'],
    );
    expect(result.matched).toEqual(['question']);
    expect(result.unmatched).toEqual(['context']);
  });
});
