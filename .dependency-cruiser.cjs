/**
 * Architecture boundaries checked in CI via `pnpm lint` (blueprint §6.2, §24).
 * ESLint handles code rules; this handles what ESLint cannot see: the import graph.
 *
 * @type {import('dependency-cruiser').IConfiguration}
 */

/**
 * The API's bounded contexts (apps/api/src/modules/<context>/, ADR-0031), in dependency
 * order: a context may import only contexts listed before it. That keeps the context
 * graph, and the Nest module imports that follow it, free of cycles. A new dependency
 * that points forward means either moving the context in this list (if nothing on the
 * way depends back on it) or moving the feature to the context that owns it.
 */
const API_CONTEXTS = [
  // Shared kernel and platform tooling
  'audit',
  'outbox',
  'idempotency',
  'health',
  'ops',
  // Platform, access and tenancy
  'access',
  'auth',
  'tenancy',
  // Messaging
  'notifications',
  // Core domains
  'pms',
  'operations',
  'finance',
  'front-office',
  'hr',
  // Guest experience, add-ons and read models
  'guest-portal',
  'fnb',
  'privacy',
  'devices',
  'calendar',
  'management',
  // Scheduled jobs call into everything
  'jobs',
];

const contextPath = (names) => `^apps/api/src/modules/(${names.join('|')})/`;

module.exports = {
  forbidden: [
    ...API_CONTEXTS.slice(0, -1).map((context, index) => ({
      name: 'no-api-module-cycles',
      comment:
        `The ${context} context may only import contexts listed before it in API_CONTEXTS ` +
        '(.dependency-cruiser.cjs), so contexts never depend on each other in a cycle. ' +
        "Call the other context's exported service, put shared helpers in common/ or " +
        'infrastructure/, or move the feature to the context that owns it.',
      severity: 'error',
      from: { path: contextPath([context]) },
      to: { path: contextPath(API_CONTEXTS.slice(index + 1)) },
    })),
    {
      name: 'api-context-listed',
      comment: 'Every folder under apps/api/src/modules/ is a context listed in API_CONTEXTS.',
      severity: 'error',
      from: { path: '^apps/api/src/modules/', pathNot: contextPath(API_CONTEXTS) },
      to: {},
    },
    {
      name: 'no-api-subcontext-cycles',
      comment:
        'Folders inside a context (e.g. finance/folio, operations/housekeeping) may not ' +
        'depend on each other in a cycle.',
      severity: 'error',
      scope: 'folder',
      from: { path: '^apps/api/src/modules/[^/]+/[^/]+' },
      to: { path: '^apps/api/src/modules/[^/]+/[^/]+', circular: true },
    },
    {
      name: 'no-shared-kernel-to-modules',
      comment:
        'common/, infrastructure/ and config/ are used by every module, so they may not ' +
        'import a feature module; that would put every module in one cycle.',
      severity: 'error',
      from: { path: '^apps/api/src/(common|infrastructure|config)/' },
      to: { path: '^apps/api/src/modules/' },
    },
    {
      name: 'no-api-file-cycles',
      comment: 'Files in the API may not import each other in a cycle.',
      severity: 'error',
      from: { path: '^apps/api/src/' },
      to: { circular: true },
    },
  ],
  options: {
    includeOnly: '^apps/api/src/',
    exclude: { path: '\\.test\\.ts$' },
    // Count type-only imports too: they couple modules just the same.
    tsPreCompilationDeps: true,
    enhancedResolveOptions: { extensions: ['.ts', '.js'] },
  },
};
