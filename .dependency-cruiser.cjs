/**
 * Architecture boundaries checked in CI via `pnpm lint` (blueprint §6.2, §24).
 * ESLint handles code rules; this handles what ESLint cannot see: the import graph.
 *
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: 'no-api-module-cycles',
      comment:
        'API modules may not depend on each other in a cycle (a → b → … → a). Put shared ' +
        'helpers in common/ or infrastructure/, and move a feature to the module that owns it.',
      severity: 'error',
      scope: 'folder',
      from: { path: '^apps/api/src/modules/[^/]+$' },
      to: { path: '^apps/api/src/modules/[^/]+$', circular: true },
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
