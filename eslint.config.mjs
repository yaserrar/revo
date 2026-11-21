// Shared flat config for every package except apps/web (which extends it with Next's rules).
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export const ignores = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.next/**',
  '**/coverage/**',
  '**/generated/**',
  '**/playwright-report/**',
  '**/test-results/**',
  'eval/results/**',
];

export const base = tseslint.config(
  { ignores },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    // CLIs, seeds and scripts print to stdout on purpose.
    files: ['**/scripts/**', '**/src/cli/**', '**/prisma/seed/**', 'eval/**', 'tools/**'],
    rules: { 'no-console': 'off' },
  },
  prettier,
);

export default base;
