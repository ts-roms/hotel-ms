import { describe, expect, it } from 'vitest';
import { escapeHtml } from './index.js';

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<a href="x?a=1&b='2'">`)).toBe(
      '&lt;a href=&quot;x?a=1&amp;b=&#39;2&#39;&quot;&gt;',
    );
  });

  it('leaves other text alone', () => {
    expect(escapeHtml('₱1,234.50 · Room 101')).toBe('₱1,234.50 · Room 101');
  });
});
