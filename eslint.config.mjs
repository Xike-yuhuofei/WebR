import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'fixtures/**',
      'realworld/**',
      '*.webr/**',
    ],
  },
  {
    files: ['**/*.{js,mjs,ts}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.es2022 },
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
);
