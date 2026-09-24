// Lint rules that catch what tsc does not: unhandled promises, non-exhaustive
// switches, `any`, and Svelte 5 reactivity mistakes. Existing violations are
// recorded in eslint-suppressions.json (`npm run lint:baseline`), so the gate
// fails only on new ones; fix a suppressed file and run
// `npm run lint -- --prune-suppressions` to shrink the list.

import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.svelte-kit/**',
      'coverage/**',
      '.omc/**',
      '.graphify/**',
      'apps/api/src/migrations/**',
      'apps/api/src/platform/db/schema.ts',
      'apps/web/static/**',
      'apps/web/svelte.config.js',
      // SvelteKit keeps the service worker out of the app tsconfig (webworker lib).
      'apps/web/src/service-worker.ts',
      'packages/shared/src/emoji.ts',
      'scripts/geoip/**',
      '**/*.cjs',
      'eslint.config.mjs'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...svelte.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
      parserOptions: {
        // Explicit projects: the test configs add Node types and the e2e files,
        // which the plain tsconfig.json files do not include.
        project: [
          './apps/api/tsconfig.json',
          './apps/web/tsconfig.test.json',
          './packages/shared/tsconfig.test.json',
          './scripts/tsconfig.json'
        ],
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.svelte']
      }
    }
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.svelte']
      }
    }
  },
  {
    rules: {
      // node:test's test()/describe() return promises the runner awaits itself.
      '@typescript-eslint/no-floating-promises': ['error', {
        allowForKnownSafeCalls: [{ from: 'package', package: 'node:test', name: ['test', 'it', 'describe', 'suite', 'before', 'after', 'beforeEach', 'afterEach'] }]
      }],
      // Stylistic: async functions without await are common in fakes and handlers.
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
      '@typescript-eslint/switch-exhaustiveness-check': ['error', { considerDefaultExhaustiveForUnions: true }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'svelte/no-at-html-tags': 'error'
    }
  }
);
