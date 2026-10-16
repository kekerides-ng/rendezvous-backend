import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

/**
 * Type-checked rules are on, because they are the ones that catch real bugs in
 * async DB and queue code — an unawaited insert is a silently lost write, and
 * that is the class of bug that costs money in an escrow system.
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'drizzle/**', 'coverage/**', 'chain/deployments/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',

      // Money is micro-USDC in bigint. `any` erases exactly the type we care about.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',

      // Keeps type-only imports out of the emitted JS, which matters for Nest's
      // circular-dependency behaviour at runtime.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],

      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // Nest controllers and providers use decorators and parameter properties.
      '@typescript-eslint/parameter-properties': 'off',
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],

      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'error', // pino only: structured logs with redaction (CLAUDE.md rule 9)
    },
  },

  // Config files are not in the TS program; type-checked rules cannot run there.
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    rules: { 'no-console': 'off' },
  },

  {
    files: ['test/**/*.ts', '**/*.spec.ts', '**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },

  prettier,
);
