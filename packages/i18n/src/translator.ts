/** A flat map of message keys to English (source) strings. */
export type Catalog = Readonly<Record<string, string>>;

/** Values substituted for `{name}` placeholders. */
export type Vars = Readonly<Record<string, string | number>>;

export type Translate<K extends string> = (key: K, vars?: Vars) => string;

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * A typed lookup over one catalog. `t(key)` returns the message exactly as written; with
 * `vars`, each `{name}` placeholder is replaced by `vars.name`. Placeholders without a value
 * are left as they are, so a forgotten variable shows up instead of going silently blank.
 *
 * Keys are checked at compile time. A key missing from the catalog (only reachable by
 * casting) yields `undefined` at run time, like the plain property lookup it replaces.
 */
export function createTranslator<C extends Catalog>(catalog: C): Translate<keyof C & string> {
  return (key, vars) => {
    const message = catalog[key] as string;
    if (!vars || message === undefined) return message;
    return message.replace(PLACEHOLDER, (match, name: string) =>
      Object.hasOwn(vars, name) ? String(vars[name]) : match,
    );
  };
}
