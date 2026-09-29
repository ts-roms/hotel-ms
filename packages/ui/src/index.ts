/**
 * Shared UI in the shadcn/ui style (Radix + Tailwind + cva). One file per component:
 *
 * - `components/` — shadcn primitives (button, dialog, table, checkbox, ...).
 * - `blocks/`     — app-level compositions built from the primitives (page header, stat card, ...).
 *
 * Components use semantic color tokens (bg-primary, text-muted-foreground, ...) and animation
 * tokens (animate-shimmer, animate-fade-in, ...) defined by each app's Tailwind theme, so the
 * guest portal can brand them differently from the staff app. Import from the package root or
 * from a single component path, e.g. `@hotel/ui/components/button`.
 */
export { cn } from './lib/utils.js';

export * from './components/alert.js';
export * from './components/alert-dialog.js';
export * from './components/avatar.js';
export * from './components/badge.js';
export * from './components/button.js';
export * from './components/card.js';
export * from './components/checkbox.js';
export * from './components/collapsible.js';
export * from './components/dialog.js';
export * from './components/input.js';
export * from './components/label.js';
export * from './components/native-select.js';
export * from './components/popover.js';
export * from './components/radio-group.js';
export * from './components/separator.js';
export * from './components/sheet.js';
export * from './components/skeleton.js';
export * from './components/spinner.js';
export * from './components/table.js';
export * from './components/textarea.js';
export * from './components/toggle.js';

export * from './blocks/empty-state.js';
export * from './blocks/loading.js';
export * from './blocks/page-header.js';
export * from './blocks/stat-card.js';
export * from './blocks/top-progress.js';
