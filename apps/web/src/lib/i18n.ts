// Add new keys in packages/i18n/src/staff.ts — this file only re-exports the staff catalog.
/**
 * UI strings live in catalogs, not in components (spec §54). The staff catalog is in the
 * shared `@hotel/i18n` package; web code keeps importing `t` and `MessageKey` from here.
 */
import { createRich } from '@hotel/i18n/react';
import { t } from '@hotel/i18n/staff';

export { t, type MessageKey } from '@hotel/i18n/staff';

/**
 * Like `t(key, vars)`, but the values may be elements (e.g. a `<strong>` inside a
 * sentence), so the translated sentence keeps its word order around them.
 */
export const rich = createRich(t);
