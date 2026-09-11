import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // mobile/ is the Expo app — React Native globals, its own toolchain and its
  // own bundler. Linting it with browser globals from here only produces noise.
  globalIgnores(['dist', 'mobile']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: {
        ...globals.browser,
        // Substituted by Vite's `define` at build time, so they exist in the bundle but
        // never in the source. Declared readonly: assigning to one would compile to an
        // assignment to a string literal, which fails silently in a way nothing else would
        // catch.
        __BUILD_SHA__: 'readonly',
        __BUILD_TIME__: 'readonly',
      },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
])
