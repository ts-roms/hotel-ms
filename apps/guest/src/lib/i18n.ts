import { type MessageKey, t } from '@hotel/i18n/guest';
import { createRich } from '@hotel/i18n/react';

// Add new keys in packages/i18n/src/guest.ts.
export { t, type MessageKey };

/**
 * Like `t(key, vars)`, but the values may be elements (e.g. a `<strong>` inside a
 * sentence), so the translated sentence keeps its word order around them.
 */
export const rich = createRich(t);
