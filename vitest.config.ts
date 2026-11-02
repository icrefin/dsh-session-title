import { defineConfig } from 'vitest/config'

export default defineConfig({
  // The settings page is a real component, so JSX must compile with the
  // automatic runtime rather than whatever esbuild defaults to.
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['test/**/*.spec.ts', 'test/**/*.spec.tsx'],
  },
})
