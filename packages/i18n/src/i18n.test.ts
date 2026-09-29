import { describe, expect, it } from 'vitest';
import { en as guest, t as guestT } from './guest.js';
import { createTranslator } from './index.js';
import { en as staff, t as staffT } from './staff.js';

describe('createTranslator', () => {
  const t = createTranslator({
    plain: 'Sign in',
    greeting: 'Hello, {name}',
    total: '{count} items for {amount}',
    braces: 'Use {name} twice: {name}',
  });

  it('returns the message unchanged without variables', () => {
    expect(t('plain')).toBe('Sign in');
    expect(t('greeting')).toBe('Hello, {name}');
  });

  it('fills {name} placeholders', () => {
    expect(t('greeting', { name: 'Ana' })).toBe('Hello, Ana');
    expect(t('total', { count: 3, amount: '₱1,200.00' })).toBe('3 items for ₱1,200.00');
    expect(t('braces', { name: 'x' })).toBe('Use x twice: x');
  });

  it('leaves placeholders without a value visible', () => {
    expect(t('total', { count: 0 })).toBe('0 items for {amount}');
  });

  it('does not re-interpret placeholders inside substituted values', () => {
    expect(t('greeting', { name: '{name}' })).toBe('Hello, {name}');
  });

  it('yields undefined for a key missing from the catalog, like a plain lookup', () => {
    // Only reachable by casting: keys are checked at compile time.
    expect(t('nope' as 'plain')).toBeUndefined();
    expect(t('nope' as 'plain', { name: 'x' })).toBeUndefined();
  });
});

describe('catalogs', () => {
  it.each([
    ['staff', staff],
    ['guest', guest],
  ])('the %s catalog has no empty messages', (_name, catalog) => {
    const empty = Object.entries(catalog).filter(([, message]) => message.trim() === '');
    expect(empty).toEqual([]);
  });

  it('exposes a translator per catalog', () => {
    expect(staffT('login.title')).toBe('Sign in');
    expect(guestT('stay.hello', { name: 'Ana' })).toBe('Hello, Ana');
  });
});
