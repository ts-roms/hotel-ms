import { describe, expect, it } from 'vitest';
import {
  cartCount,
  cartTotal,
  defaultModifierIds,
  linePrice,
  newCartLine,
  selectedInGroup,
  toggleModifier,
  unitPrice,
} from './fnb-cart.js';
import type { MenuItem, ModifierGroup } from './fnb.js';

const size: ModifierGroup = {
  id: 'g-size',
  name: 'Size',
  minSelect: 1,
  maxSelect: 1,
  modifiers: [
    { id: 'm-regular', name: 'Regular', priceMinor: 0 },
    { id: 'm-large', name: 'Large', priceMinor: 5_000 },
  ],
};
const extras: ModifierGroup = {
  id: 'g-extras',
  name: 'Extras',
  minSelect: 0,
  maxSelect: 2,
  modifiers: [
    { id: 'm-egg', name: 'Egg', priceMinor: 2_000 },
    { id: 'm-cheese', name: 'Cheese', priceMinor: 3_000 },
    { id: 'm-bacon', name: 'Bacon', priceMinor: 4_000 },
  ],
};
const item = { id: 'i-1', priceMinor: 25_000, modifierGroups: [size, extras] } as MenuItem;

describe('fnb cart', () => {
  it('starts a line with the first options of required groups', () => {
    expect(defaultModifierIds(item)).toEqual(['m-regular']);
    expect(newCartLine(item)).toEqual({ item, quantity: 1, modifierIds: ['m-regular'] });
  });

  it('prices a unit, a line and a cart with modifiers', () => {
    const line = { item, quantity: 2, modifierIds: ['m-large', 'm-egg'] };
    expect(unitPrice(line)).toBe(32_000);
    expect(linePrice(line)).toBe(64_000);
    const other = newCartLine(item);
    expect(cartTotal([line, other])).toBe(89_000);
    expect(cartCount([line, other])).toBe(3);
  });

  it('switches a single-choice group', () => {
    expect(toggleModifier(['m-regular', 'm-egg'], size, 'm-large')).toEqual(['m-egg', 'm-large']);
  });

  it('toggles a multi-choice group and drops the oldest pick past maxSelect', () => {
    let ids = toggleModifier(['m-regular'], extras, 'm-egg');
    expect(ids).toEqual(['m-regular', 'm-egg']);
    ids = toggleModifier(ids, extras, 'm-cheese');
    ids = toggleModifier(ids, extras, 'm-bacon');
    expect(selectedInGroup(ids, extras)).toEqual(['m-cheese', 'm-bacon']);
    expect(toggleModifier(ids, extras, 'm-cheese')).toEqual(['m-regular', 'm-bacon']);
  });
});
