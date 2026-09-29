import type { Tx } from '@hotel/database';
import { describe, expect, it } from 'vitest';
import { FeatureFlagsService } from './feature-flags.service.js';

function flags(definition: { defaultEnabled: boolean } | null, override: boolean | null) {
  const tx = {
    featureFlagDefinition: { findUnique: async () => definition },
    organizationFeatureFlag: {
      findUnique: async () => (override === null ? null : { enabled: override }),
    },
  } as unknown as Tx;
  const cls = { get: () => 'org-1' };
  const service = new FeatureFlagsService(null as never, cls as never, null as never);
  return service.isEnabledInTx(tx, 'self_checkin');
}

describe('FeatureFlagsService.isEnabledInTx', () => {
  it("uses the flag's default when the organization has not set it", async () => {
    await expect(flags({ defaultEnabled: true }, null)).resolves.toBe(true);
    await expect(flags({ defaultEnabled: false }, null)).resolves.toBe(false);
  });

  it("prefers the organization's own setting", async () => {
    await expect(flags({ defaultEnabled: true }, false)).resolves.toBe(false);
    await expect(flags({ defaultEnabled: false }, true)).resolves.toBe(true);
  });

  it('treats a flag the platform does not define as off', async () => {
    await expect(flags(null, true)).resolves.toBe(false);
  });
});
