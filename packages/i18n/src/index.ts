/**
 * Message catalogs for the staff and guest apps (spec §54). UI strings live in catalogs,
 * not in components; each app imports its own catalog entry (`@hotel/i18n/staff`,
 * `@hotel/i18n/guest`). One locale for now; the lookup shape stays the same when more
 * locales are added. Money and date formatting lives in `@hotel/format`.
 */
export { type Catalog, createTranslator, type Translate, type Vars } from './translator.js';
