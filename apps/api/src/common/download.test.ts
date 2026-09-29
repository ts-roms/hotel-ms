import { describe, expect, it } from 'vitest';
import { attachmentHeader } from './download.js';

describe('attachmentHeader', () => {
  it('builds a safe Content-Disposition for any file name', () => {
    expect(attachmentHeader('contract.pdf')).toBe(
      `attachment; filename="contract.pdf"; filename*=UTF-8''contract.pdf`,
    );
    expect(attachmentHeader('a"b\\c ñ.pdf')).toBe(
      `attachment; filename="a_b_c _.pdf"; filename*=UTF-8''a%22b%5Cc%20%C3%B1.pdf`,
    );
  });
});
