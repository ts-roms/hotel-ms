import { createElement, Fragment, type ReactNode } from 'react';
import type { Translate } from './translator.js';

/** Values for `{name}` placeholders that may be elements (e.g. a `<strong>` in a sentence). */
export type RichVars = Readonly<Record<string, ReactNode>>;

/**
 * Fills a message's `{name}` placeholders with React nodes, so a translated sentence keeps its
 * own word order around markup. Placeholders without a value stay visible, like `t()`.
 */
export function richText(message: string, vars: RichVars): ReactNode {
  const parts = message.split(/\{(\w+)\}/);
  // split() with a capture group: odd indexes are placeholder names.
  return createElement(
    Fragment,
    null,
    ...parts.map((part, i) => (i % 2 === 1 ? (vars[part] ?? `{${part}}`) : part)),
  );
}

/**
 * A `rich(key, vars)` bound to one catalog's translator: like `t(key, vars)`, but the values
 * may be elements.
 */
export function createRich<K extends string>(
  t: Translate<K>,
): (key: K, vars: RichVars) => ReactNode {
  return (key, vars) => richText(t(key), vars);
}
