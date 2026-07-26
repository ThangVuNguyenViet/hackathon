import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'artifacts/**',
      '.artifacts/**',
      'dist/**',
      'node_modules/**',
      '.wrangler/**',
    ],
  },
  {
    files: ['**/*.ts'],
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-type-assertion': 'warn',
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: true },
      ],
    },
  },
  {
    files: ['scripts/**/*.ts', 'test/**/*.ts'],
    rules: {
      // Browser adapters and legacy test builders mirror third-party callback types.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['eslint.config.mjs', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': 'error',
    },
  },
);
