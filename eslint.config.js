import js from '@eslint/js';
import globals from 'globals';

// Browser checks run as page scripts; the runners pass page functions to Chrome.
const page = {
  ...globals.browser,
  spoolNative: 'readonly',
  __copyOriginal: 'writable',
  __drag: 'writable',
  __snapping: 'writable',
  __timelineGestures: 'writable',
  __timelineOriginal: 'writable',
  __timelineW: 'writable',
};

export default [
  { ignores: ['node_modules/', '.native-test/', 'docs/', 'promo/', 'demo/'] },
  js.configs.recommended,
  { files: ['ui/**/*.js', 'web/**/*.js'], languageOptions: { sourceType: 'module', globals: globals.browser } },
  { files: ['eslint.config.js', 'tests/**/*.mjs'], languageOptions: { sourceType: 'module', globals: globals.node } },
  { files: ['tests/**/*.cjs'], languageOptions: { sourceType: 'commonjs', globals: { ...globals.node, ...page } } },
  { files: ['tests/**/*.js'], languageOptions: { sourceType: 'script', globals: page } },
  {
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
    },
  },
];
