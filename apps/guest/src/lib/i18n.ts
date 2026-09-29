import { type MessageKey, t } from '@hotel/i18n/guest';
import { createElement, Fragment, type ReactNode } from 'react';

// Add new keys in packages/i18n/src/guest.ts.
export { t, type MessageKey };

/**
 * Like `t(key, vars)`, but the values may be elements (e.g. a `<strong>` inside a
 * sentence), so the translated sentence keeps its word order around them.
 */
export function rich(key: MessageKey, vars: Readonly<Record<string, ReactNode>>): ReactNode {
  const parts = t(key).split(/\{(\w+)\}/);
  // split() with a capture group: odd indexes are placeholder names.
  return createElement(
    Fragment,
    null,
    ...parts.map((part, i) => (i % 2 === 1 ? (vars[part] ?? `{${part}}`) : part)),
  );
}
