// Lint rules that catch what tsc does not: unhandled promises, non-exhaustive
// switches, `any` and Vue template mistakes.
// Existing violations are recorded in eslint-suppressions.json
// (`npm run lint:baseline`), so the gate fails only on new ones; fix a
// suppressed file and run `npm run lint -- --prune-suppressions` to shrink
// the list.

import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import vue from 'eslint-plugin-vue';

// A cast written as overloads: public signatures promise a type, and the
// implementation behind them answers unknown (or leaves its answer unstated).
// Only the declared trust points at the end of this file may do that.
const OVERLOAD_CAST = [
  'ExportNamedDeclaration:has(> TSDeclareFunction) + ExportNamedDeclaration > FunctionDeclaration',
  'TSDeclareFunction + FunctionDeclaration'
].map((overloaded) => ({
  selector: `${overloaded}:matches([returnType.typeAnnotation.type='TSUnknownKeyword'], :not([returnType]))`,
  message: 'Overloads over an unknown-returning implementation are a cast; prove the type with a guard instead.'
}));

const ROOM_LOBBY_IMPORTS = {
  group: ['@/features/home', '@/features/home/**', '**/features/home/**'],
  message: 'A room does not import the lobby: use @/entities or the room social context.'
};
const PORTABLE_IMPORT_MESSAGE = 'Portable packages cannot import applications or app aliases.';
const PORTABLE_APP_IMPORTS = '^@(?:/|$)|^@voiceroom/(?:admin|api|docs|meet|site|web|widget)(?:/|$)|(?:^|/)apps(?:/|$)';
// The kit is the bottom UI layer: of our packages it may import only @voiceroom/shared.
const KIT_IMPORTS = `${PORTABLE_APP_IMPORTS}|^@voiceroom/(?:ui|call)(?:/|$)`;
const KIT_IMPORT_MESSAGE =
  'The UI kit imports only @voiceroom/shared of our packages; move what it needs into the kit.';

function importBoundary(pattern, message) {
  return {
    'no-restricted-imports': ['error', { patterns: [{ regex: pattern, message: message }] }],
    'no-restricted-syntax': [
      'error',
      ...OVERLOAD_CAST,
      ...[
        'ImportExpression[source.value',
        'ImportExpression[source.quasis.0.value.cooked',
        'TSImportType[source.value'
      ].map((selector) => ({
        selector: `${selector}=/${pattern.replaceAll('/', '\\/')}/]`,
        message: message
      }))
    ]
  };
}

// The package suites use Web-owned helpers and fixtures, and call tests exercise
// the Web host via its @/ alias. Keep other app imports (and upward kit imports)
// forbidden in tests too. Both runners share the single Web Vitest factory.
const webHarness = String.raw`(?:\.\./)+apps/web/test/(?:helpers|fixtures)/[\w.-]+`;
// Capture diagnostics generates records and validates them against the real
// intake contract. This permits the normalizer, not the API's other modules.
const logIntake = String.raw`(?:\.\./)+apps/api/src/lib/client-log-intake\.ts`;
const vitestFactory = String.raw`(?:\.\./)+apps/web/scripts/vitest-projects\.ts`;
function exceptImports(forbidden, permitted) {
  return `^(?!(?:${permitted})$).*(?:${forbidden})`;
}

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'packages/ui-kit/storybook-static/**',
      'coverage/**',
      '.omc/**',
      '.omx/**',
      'apps/api/src/platform/db/schema.ts',
      'apps/web/public/**',
      'packages/call/assets/**',
      'apps/site/public/**',
      'apps/site/.astro/**',
      'apps/docs/**',
      'packages/shared/src/emoji.ts',
      'scripts/geoip/**',
      '**/*.cjs',
      'eslint.config.mjs'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  // Vue rules apply to the Vue apps and the portable packages.
  ...vue.configs['flat/recommended-error'].map((config) => ({
    ...config,
    files: config.files ?? ['apps/{admin,meet,web,widget}/**/*.{ts,vue}', 'packages/{call,ui,ui-kit}/**/*.{ts,vue}']
  })),
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
      parserOptions: {
        // Explicit projects: the test configs add Node types and the e2e files,
        // which the plain tsconfig.json files do not include.
        project: [
          './apps/api/tsconfig.json',
          './apps/admin/tsconfig.json',
          './apps/site/tsconfig.json',
          './apps/web/tsconfig.test.json',
          './apps/meet/tsconfig.test.json',
          './apps/widget/tsconfig.test.json',
          './packages/shared/tsconfig.test.json',
          './packages/ui/tsconfig.json',
          './packages/ui-kit/tsconfig.json',
          './packages/ui-kit/tsconfig.test.json',
          './packages/call/tsconfig.json',
          './packages/call/tsconfig.test.json',
          './scripts/tsconfig.json'
        ],
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.vue']
      }
    }
  },
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue']
      }
    },
    rules: {
      // Prettier owns the layout of templates, as it does everywhere else.
      ...vue.configs['no-layout-rules'].rules,
      // apps/web/AGENTS.md: <script setup lang="ts"> only.
      'vue/block-lang': ['error', { script: { lang: 'ts' } }],
      'vue/component-api-style': ['error', ['script-setup']],
      // Component names are single words (Button, Dialog, Select); templates
      // write them in PascalCase, so they never clash with HTML elements.
      'vue/multi-word-component-names': 'off',
      // Raw HTML bypasses escaping; render text or build nodes instead.
      'vue/no-v-html': 'error'
    }
  },
  {
    rules: {
      // node:test's and Vitest's test()/describe() return promises the runner awaits itself.
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          allowForKnownSafeCalls: [
            {
              from: 'package',
              package: 'node:test',
              name: ['test', 'it', 'describe', 'suite', 'before', 'after', 'beforeEach', 'afterEach']
            },
            { from: 'package', package: 'vitest', name: ['test', 'it', 'describe', 'suite'] }
          ]
        }
      ],
      // Stylistic: async functions without await are common in fakes and handlers.
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
      '@typescript-eslint/switch-exhaustiveness-check': ['error', { considerDefaultExhaustiveForUnions: true }],
      '@typescript-eslint/no-explicit-any': 'error',
      // strictTypeChecked, except the rules that trust a type over the value
      // at runtime. lib.dom, LiveKit and the desktop bridge type optional
      // features and flags as always there (navigator.mediaDevices,
      // crypto.randomUUID, publication.isDesired), and narrowing ignores state
      // that changes across an await or a callback; obeying these rules would
      // delete the very guards that keep calls working in real browsers.
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-unnecessary-boolean-literal-compare': 'off',
      '@typescript-eslint/no-unnecessary-type-conversion': 'off',
      // `() => boolean | void` callbacks and Promise.withResolvers<void>() are deliberate.
      '@typescript-eslint/no-invalid-void-type': 'off',
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true, allowBoolean: true }],
      // Test doubles stand in for browser classes: empty or static-only on purpose.
      '@typescript-eslint/no-extraneous-class': ['error', { allowEmpty: true, allowStaticOnly: true }],
      '@typescript-eslint/no-deprecated': [
        'error',
        {
          allow: [
            // The platform tells macOS (hotkey labels, the download) and iPadOS, which
            // reports a desktop user agent, apart.
            { from: 'lib', name: 'platform' },
            // The microphone noise gate falls back to a ScriptProcessor without AudioWorklet.
            { from: 'lib', name: ['createScriptProcessor', 'onaudioprocess', 'inputBuffer', 'outputBuffer'] }
          ]
        }
      ],
      // A type is proved by a guard or a contract check, never asserted; `as const` stays allowed.
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }
      ],
      'no-restricted-syntax': ['error', ...OVERLOAD_CAST]
    }
  },
  {
    // Browser code logs through @/shared/log so records reach the failure
    // report buffer; only the logger itself touches the console.
    files: ['apps/{meet,web}/src/**/*.{ts,vue}', 'packages/call/src/**/*.{ts,vue}'],
    ignores: ['apps/web/src/shared/log.ts'],
    rules: { 'no-console': 'error' }
  },
  {
    files: ['packages/{call,ui,ui-kit}/**/*.{ts,tsx,mts,js,jsx,mjs,vue}'],
    rules: importBoundary(PORTABLE_APP_IMPORTS, PORTABLE_IMPORT_MESSAGE)
  },
  {
    // The kit is the bottom UI layer (DESIGN.md, "Kit only"): everything else
    // depends on it, so it may not depend on @voiceroom/ui or @voiceroom/call.
    files: ['packages/ui-kit/**/*.{ts,tsx,mts,js,jsx,mjs,vue}'],
    ignores: ['packages/ui-kit/.storybook/**'],
    rules: importBoundary(KIT_IMPORTS, KIT_IMPORT_MESSAGE)
  },
  {
    files: ['packages/ui-kit/test/**'],
    rules: importBoundary(exceptImports(KIT_IMPORTS, webHarness), KIT_IMPORT_MESSAGE)
  },
  {
    files: ['packages/call/test/**'],
    rules: importBoundary(
      exceptImports(PORTABLE_APP_IMPORTS, `${webHarness}|${logIntake}|@/[\\w/.-]+`),
      PORTABLE_IMPORT_MESSAGE
    )
  },
  ...['call', 'ui-kit'].map((name) => ({
    files: [`packages/${name}/vitest.config.ts`],
    rules: importBoundary(
      exceptImports(name === 'call' ? PORTABLE_APP_IMPORTS : KIT_IMPORTS, vitestFactory),
      PORTABLE_IMPORT_MESSAGE
    )
  })),
  {
    // docs/ARCHITECTURE.md section 5: the lobby shows rooms, never the other way
    // round. What both need lives in @/entities; what a room needs from the
    // lobby comes through a context (features/room/social.ts).
    files: ['apps/web/src/features/room/**/*.{ts,vue}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [ROOM_LOBBY_IMPORTS]
        }
      ]
    }
  },
  {
    // Layers below the features never reach up into one.
    files: ['apps/web/src/{entities,shared,platform,api}/**/*.{ts,vue}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/features/home',
                '@/features/home/**',
                '@/features/room',
                '@/features/room/**',
                '**/features/home/**',
                '**/features/room/**'
              ],
              message: 'entities, shared, platform and api sit below the features and do not import them.'
            }
          ]
        }
      ]
    }
  },
  {
    // The lobby reaches the call engine only through its public index.
    files: ['apps/web/src/features/home/**/*.{ts,vue}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@voiceroom/call/engine/**', '**/call/src/engine/**'],
              message: 'Import the call engine from @voiceroom/call/engine, its public index.'
            }
          ]
        }
      ]
    }
  },
  {
    // A request's logger already binds reqId; repeating it writes the field twice.
    files: ['apps/api/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "Property[key.name='reqId'][value.type=/MemberExpression|ChainExpression/]",
          message: 'request.log already carries reqId; do not add it again.'
        },
        ...OVERLOAD_CAST
      ]
    }
  },
  {
    // The declared trust points hand a value over as the type the caller names;
    // that is their one job. Test doubles (fake, mistyped, recordingService) and
    // the app's store seam (standIn), which phase 4 is to replace with narrow ports.
    files: ['**/test/helpers/**', '**/test/fakes/**', 'apps/api/src/app/store-overrides.ts'],
    rules: {
      '@typescript-eslint/no-unnecessary-type-parameters': 'off',
      'no-restricted-syntax': 'off'
    }
  },
  {
    files: ['apps/api/src/**/*.ts'],
    ignores: ['apps/api/src/domains/social/**', 'apps/api/src/migrations/**', 'apps/api/src/app/store-overrides.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "Property[key.name='reqId'][value.type=/MemberExpression|ChainExpression/]",
          message: 'request.log already carries reqId; do not add it again.'
        },
        ...OVERLOAD_CAST,
        {
          selector:
            "CallExpression[callee.property.name='selectFrom'] > Literal.arguments[value=/^(friendships|user_blocks)( |$)/]",
          message: 'Read contact facts through the social domain.'
        }
      ],
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['**/pair-eligibility*'], message: 'Use the contact policy.' }] }
      ]
    }
  }
);
