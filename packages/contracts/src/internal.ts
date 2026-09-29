import { z } from 'zod';

/**
 * Helpers shared by several contract files but not part of the public API: `index.ts` does
 * not re-export this file.
 */

/** Inventory and rate plan codes. */
export const codeSchema = z
  .string()
  .regex(/^[A-Z0-9][A-Z0-9_-]{0,15}$/, 'Uppercase letters, digits, - and _ (1-16 chars)');

/** Signed integer minor units: folio lines and balances. */
export const signedMinorSchema = z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000);

/** HR codes and names (departments, positions, shift templates, leave types). */
export const hrCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Z0-9_-]{1,20}$/, 'Use 1–20 capital letters, digits, "-" or "_"');
export const hrNameSchema = z.string().trim().min(1).max(100);
