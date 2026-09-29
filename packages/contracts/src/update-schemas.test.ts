import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as contracts from './index.js';

/** Every update (PATCH) request schema the package exports. */
const updateSchemas: [string, z.ZodType][] = Object.entries(contracts).flatMap(([name, value]) =>
  /^update\w*Schema$/.test(name) && value instanceof z.ZodType ? [[name, value]] : [],
);

/** The properties of an object schema (through refinements), as JSON Schema. */
function properties(schema: z.ZodType): Record<string, { default?: unknown }> {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as {
    properties?: Record<string, { default?: unknown }>;
  };
  return json.properties ?? {};
}

describe('update request schemas (ADR-0009)', () => {
  it('are all checked', () => {
    expect(updateSchemas.length).toBeGreaterThan(10);
  });

  it.each(updateSchemas)(
    '%s has no defaults, so a PATCH never resets the fields it omits',
    (_, schema) => {
      const defaulted = Object.entries(properties(schema)).filter(([, p]) => 'default' in p);
      expect(defaulted.map(([field]) => field)).toEqual([]);
      const empty = schema.safeParse({});
      if (empty.success) expect(empty.data).toEqual({});
    },
  );
});
