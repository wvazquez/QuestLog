import { defineConfig } from 'vite'

export default defineConfig({
  base: '/QuestLog/',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main:    'index.html',
        auth:    'auth.html',
        landing: 'landing.html',
      },
    },
  },
})
