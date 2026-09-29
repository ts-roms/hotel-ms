// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Lint rules that protect architecture decisions, not just style. The tenant-safety
 * rules below are the important part; see ADR-0003.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/generated/**',
      '**/node_modules/**',
      '**/*.config.*',
      '.dependency-cruiser.cjs',
      'apps/web/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  // --- Tenant safety -------------------------------------------------------------------
  {
    files: ['apps/**/*.ts', 'apps/**/*.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'MemberExpression[property.name=/^\\$(queryRawUnsafe|executeRawUnsafe)$/]',
          message:
            'Unsafe raw SQL is banned. Use tagged $queryRaw/$executeRaw templates (parameterized).',
        },
      ],
    },
  },
  {
    // Only the infrastructure layer creates database clients; everything else goes
    // through TenantDb so the RLS context is always set.
    files: ['apps/api/src/**/*.ts'],
    ignores: ['apps/api/src/infrastructure/database.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@hotel/database',
              importNames: ['createPrismaClient', 'withDbContext', 'PrismaClient'],
              message:
                'Use TenantDb (infrastructure/database.ts) so every query runs with a verified tenant context.',
            },
            {
              name: '@hotel/database/testing',
              message: 'Test helpers must not be imported by production code.',
            },
          ],
        },
      ],
    },
  },
  {
    // The web app must never reach server-only packages.
    files: ['apps/web/**/*.ts', 'apps/web/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@hotel/database', '@hotel/database/*'], message: 'Server-only package.' },
          ],
        },
      ],
    },
  },
);
