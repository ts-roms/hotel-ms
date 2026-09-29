import type { MenuItem, ModifierGroup } from './fnb.js';

/**
 * Cart arithmetic shared by the staff order screen and guest room service. Display only: the
 * API prices every order itself from the menu (blueprint §14).
 */

/** One dish in a cart: the menu item, how many, and the chosen modifiers. */
export interface CartLine {
  item: MenuItem;
  quantity: number;
  modifierIds: string[];
}

/** The modifiers a new line starts with: the first `minSelect` options of each required group. */
export function defaultModifierIds(item: MenuItem): string[] {
  return item.modifierGroups
    .filter((g) => g.minSelect > 0)
    .flatMap((g) => g.modifiers.slice(0, g.minSelect).map((m) => m.id));
}

/** A new cart line for one of `item`, with the default modifiers. */
export function newCartLine(item: MenuItem): CartLine {
  return { item, quantity: 1, modifierIds: defaultModifierIds(item) };
}

/** Price of one unit: the item plus its chosen modifiers, in minor units. */
export function unitPrice(line: Pick<CartLine, 'item' | 'modifierIds'>): number {
  return (
    line.item.priceMinor +
    line.item.modifierGroups
      .flatMap((g) => g.modifiers)
      .filter((m) => line.modifierIds.includes(m.id))
      .reduce((sum, m) => sum + m.priceMinor, 0)
  );
}

/** Price of the whole line (unit price × quantity), in minor units. */
export function linePrice(line: CartLine): number {
  return unitPrice(line) * line.quantity;
}

/** Total of a cart, in minor units. */
export function cartTotal(lines: readonly CartLine[]): number {
  return lines.reduce((sum, l) => sum + linePrice(l), 0);
}

/** Number of dishes in a cart (quantities added up). */
export function cartCount(lines: readonly CartLine[]): number {
  return lines.reduce((n, l) => n + l.quantity, 0);
}

/** The modifiers chosen in one group, in the order they were picked. */
export function selectedInGroup(
  modifierIds: readonly string[],
  group: Pick<ModifierGroup, 'modifiers'>,
): string[] {
  const ids = new Set(group.modifiers.map((m) => m.id));
  return modifierIds.filter((id) => ids.has(id));
}

/**
 * Picks or unpicks one modifier of a group. A single-choice group (maxSelect 1) switches to it;
 * otherwise it toggles, and picking beyond maxSelect drops the oldest pick in that group.
 * Choices in other groups are kept.
 */
export function toggleModifier(
  modifierIds: readonly string[],
  group: Pick<ModifierGroup, 'maxSelect' | 'modifiers'>,
  modifierId: string,
): string[] {
  const ids = new Set(group.modifiers.map((m) => m.id));
  const others = modifierIds.filter((id) => !ids.has(id));
  const inGroup = modifierIds.filter((id) => ids.has(id));
  const next =
    group.maxSelect === 1
      ? [modifierId]
      : inGroup.includes(modifierId)
        ? inGroup.filter((id) => id !== modifierId)
        : [...inGroup, modifierId].slice(-group.maxSelect);
  return [...others, ...next];
}
