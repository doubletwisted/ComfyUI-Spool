import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', '.native-test/', 'docs/', 'promo/', 'demo/'] },
  js.configs.recommended,
  { files: ['ui/**/*.js', 'web/**/*.js'], languageOptions: { sourceType: 'module', globals: globals.browser } },
  { files: ['eslint.config.js', 'tests/**/*.mjs'], languageOptions: { sourceType: 'module', globals: globals.node } },
  { files: ['tests/**/*.cjs'], languageOptions: { sourceType: 'commonjs', globals: globals.node } },
  // Browser checks are evaluated as page scripts by tests/run_browser_checks.cjs.
  { files: ['tests/**/*.js'], ignores: ['eslint.config.js'], languageOptions: { sourceType: 'script', globals: globals.browser } },
  { rules: { 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }] } },
];
