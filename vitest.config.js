import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // jsdom gives us browser globals (document, window, localStorage)
    environment: 'jsdom',
    // Load .env.local for tests so VITE_ vars are available
    env: {
      VITE_SUPABASE_URL:      'https://test.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.js'],
      exclude: [
        'src/auth-entry.js',
        'src/landing-entry.js',
        'node_modules/',
        'dist/',
      ],
      thresholds: {
        // Global thresholds grow as more tests are added.
        // utils.js is fully covered; main.js tests are added incrementally.
        lines:     15,
        functions: 15,
        branches:  15,
        // Per-file: pure utility functions must stay at high coverage
        perFile: false,
      },
    },
  },
})
