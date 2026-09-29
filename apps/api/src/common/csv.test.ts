import { describe, expect, it } from 'vitest';
import { csvField, parseCsv } from './csv.js';

describe('parseCsv', () => {
  it('reads plain rows with CRLF or LF, ignoring blank lines and a BOM', () => {
    expect(parseCsv('﻿a,b,c\r\n1,2,3\n\n4,5,6\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
      ['4', '5', '6'],
    ]);
  });

  it('handles quoted fields with commas, quotes and line breaks', () => {
    expect(parseCsv('name,notes\n"Reyes, John","Says ""hi""\nand waves"\n')).toEqual([
      ['name', 'notes'],
      ['Reyes, John', 'Says "hi"\nand waves'],
    ]);
  });

  it('keeps empty fields and a last row without a newline', () => {
    expect(parseCsv('a,,c\n,,')).toEqual([
      ['a', '', 'c'],
      ['', '', ''],
    ]);
  });

  it('refuses an unterminated quote', () => {
    expect(() => parseCsv('a,"b\n')).toThrow(/Unterminated/);
  });

  it('round-trips what csvField writes', () => {
    const values = ['plain', 'with, comma', 'with "quote"', 'multi\nline'];
    expect(parseCsv(values.map((v) => csvField(v)).join(','))).toEqual([values]);
  });
});
