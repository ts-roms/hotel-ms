import { describe, expect, it } from 'vitest';
import { csvField } from '../../common/csv.js';

describe('payroll CSV fields', () => {
  it('quote separators, quotes and line breaks', () => {
    expect(csvField('Cruz, Carlo')).toBe('"Cruz, Carlo"');
    expect(csvField('Say "hi"')).toBe('"Say ""hi"""');
    expect(csvField('a\nb')).toBe('"a\nb"');
    expect(csvField(null)).toBe('');
    expect(csvField(480)).toBe('480');
  });

  it('defuse spreadsheet formulas in text', () => {
    expect(csvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvField('+1')).toBe("'+1");
    expect(csvField('@SUM(A1)')).toBe("'@SUM(A1)");
    // Numbers are data, not formulas.
    expect(csvField(-15)).toBe('-15');
  });
});
