/**
 * Architecture boundaries checked in CI via `pnpm lint` (blueprint §6.2, §24; ADR-0031,
 * ADR-0034). ESLint handles code rules; this handles what ESLint cannot see: the import
 * graph of the apps and packages.
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

/**
 * A context's public surface: what another context may import from it. Its services
 * (`*.service.ts`, the classes its module exports) and its module (`*.module.ts`), plus
 * these files, which export an injectable or pure functions under another name.
 */
const API_PUBLIC_FILES = [
  // KioskAuth (exported by AuthModule) and the ResolvedDevice it returns
  'auth/kiosk-auth\\.ts',
  // HrAccess (exported by HrModule): HR scope checks shared by HR's read models
  'hr/hr-access\\.ts',
  // Pure tax arithmetic, used where charges are posted (folio, F&B orders)
  'pms/pricing/tax-engine\\.ts',
];

const MODULES = '^apps/api/src/modules/';
const contextPath = (names) => `${MODULES}(${names.join('|')})/`;

module.exports = {
  forbidden: [
    // ---- API contexts (ADR-0031) -------------------------------------------------------------
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
      from: { path: MODULES, pathNot: contextPath(API_CONTEXTS) },
      to: {},
    },
    {
      name: 'api-context-public-surface',
      comment:
        "Another context is used through its public surface only: its services and module, or a file listed in API_PUBLIC_FILES. Free functions in its other files bypass the module's exports (and so Nest's check of them); make them a method of an exported service, or move a shared helper to common/.",
      severity: 'error',
      from: { path: `${MODULES}([^/]+)/` },
      to: {
        path: MODULES,
        pathNot: [
          `${MODULES}$1/`,
          '\\.(service|module)\\.ts$',
          ...API_PUBLIC_FILES.map((file) => `${MODULES}${file}$`),
        ],
      },
    },
    {
      name: 'no-api-subcontext-cycles',
      comment:
        'Folders inside a context (e.g. finance/folio, operations/housekeeping) may not ' +
        'depend on each other in a cycle.',
      severity: 'error',
      scope: 'folder',
      from: { path: `${MODULES}[^/]+/[^/]+` },
      to: { path: `${MODULES}[^/]+/[^/]+`, circular: true },
    },
    {
      name: 'no-shared-kernel-to-modules',
      comment:
        'common/, infrastructure/ and config/ are used by every module, so they may not ' +
        'import a feature module; that would put every module in one cycle.',
      severity: 'error',
      from: { path: '^apps/api/src/(common|infrastructure|config)/' },
      to: { path: MODULES },
    },
    {
      name: 'api-kernel-layers',
      comment:
        'Inside the shared kernel, infrastructure/ (adapters: database, Redis, queues, storage, ' +
        'error reporting) may use common/ (pure helpers), never the other way round; config/ ' +
        'uses neither.',
      severity: 'error',
      from: { path: '^apps/api/src/(common|config)/' },
      to: { path: '^apps/api/src/infrastructure/' },
    },
    {
      name: 'api-config-leaf',
      comment: 'config/ (environment parsing) imports nothing else of the API.',
      severity: 'error',
      from: { path: '^apps/api/src/config/' },
      to: { path: '^apps/api/src/', pathNot: '^apps/api/src/config/' },
    },
    {
      name: 'no-api-file-cycles',
      comment: 'Files in the API may not import each other in a cycle.',
      severity: 'error',
      from: { path: '^apps/api/src/' },
      to: { circular: true },
    },

    // ---- Apps and packages (ADR-0034) ----------------------------------------------------------
    {
      name: 'worker-not-api',
      comment:
        'The worker is a separate process (ADR-0017, ADR-0034): it shares code with the API ' +
        'only through packages, never by importing apps/api.',
      severity: 'error',
      from: { path: '^apps/worker/src/' },
      to: { path: '^apps/api/' },
    },
    {
      name: 'leaf-packages',
      comment:
        '@hotel/contracts, @hotel/format and @hotel/i18n are leaves: they import no app and ' +
        'no other workspace package (npm dependencies only).',
      severity: 'error',
      from: { path: '^packages/(contracts|format|i18n)/src/' },
      to: { path: ['^(apps|packages)/', '^@hotel/'], pathNot: ['^packages/$1/', '^@hotel/$1$'] },
    },
    {
      name: 'ui-is-presentational',
      comment:
        '@hotel/ui is presentational: it does not fetch data or know the API contract, so it ' +
        'imports neither @hotel/api-client, @hotel/contracts nor @hotel/database.',
      severity: 'error',
      from: { path: '^packages/ui/' },
      to: {
        path: [
          '^packages/(api-client|contracts|database)/',
          '^@hotel/(api-client|contracts|database)',
        ],
      },
    },
    {
      name: 'no-package-internals',
      comment:
        'Apps use a workspace package by its name (e.g. @hotel/contracts) and its declared ' +
        'exports, never by a relative path into its src/ or dist/.',
      severity: 'error',
      from: { path: '^apps/' },
      to: { path: '^packages/', dependencyTypes: ['local'] },
    },
    {
      name: 'packages-not-apps',
      comment: 'Packages never import an app.',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
  ],
  options: {
    // Unresolvable workspace imports (a package the importer does not declare) stay visible
    // as their module name, so the package rules still see them.
    includeOnly: ['^(apps|packages)/', '^@hotel/'],
    exclude: {
      path: ['\\.test\\.tsx?$', '/\\.next/', '/generated/'],
    },
    // Workspace packages resolve to their built dist/ (through node_modules): those files
    // are the edge's target, but are not cruised themselves.
    doNotFollow: { path: ['node_modules', '/dist/'] },
    // Count type-only imports too: they couple modules just the same.
    tsPreCompilationDeps: true,
    enhancedResolveOptions: { extensions: ['.ts', '.tsx', '.js', '.mjs'] },
  },
};

// For the API's tests (app.module.ts lists the context modules in this order); not part of
// the dependency-cruiser configuration, hence not enumerable.
Object.defineProperty(module.exports, 'API_CONTEXTS', { value: API_CONTEXTS, enumerable: false });
