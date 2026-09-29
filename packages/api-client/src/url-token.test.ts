import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenFromHash } from './url-token.js';

describe('tokenFromHash', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is null outside the browser', () => {
    expect(tokenFromHash()).toBeNull();
  });

  it('reads token from the URL fragment', () => {
    vi.stubGlobal('window', { location: { hash: '#token=abc%2B1&x=2' } });
    expect(tokenFromHash()).toBe('abc+1');
  });

  it('is null when the fragment has no token', () => {
    vi.stubGlobal('window', { location: { hash: '' } });
    expect(tokenFromHash()).toBeNull();
  });
});
