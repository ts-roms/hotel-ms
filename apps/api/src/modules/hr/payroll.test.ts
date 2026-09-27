import { describe, expect, it } from 'vitest';
import { field } from './payroll.service.js';

describe('payroll CSV fields', () => {
  it('quote separators, quotes and line breaks', () => {
    expect(field('Cruz, Carlo')).toBe('"Cruz, Carlo"');
    expect(field('Say "hi"')).toBe('"Say ""hi"""');
    expect(field('a\nb')).toBe('"a\nb"');
    expect(field(null)).toBe('');
    expect(field(480)).toBe('480');
  });

  it('defuse spreadsheet formulas in text', () => {
    expect(field('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(field('+1')).toBe("'+1");
    expect(field('@SUM(A1)')).toBe("'@SUM(A1)");
    // Numbers are data, not formulas.
    expect(field(-15)).toBe('-15');
  });
});
