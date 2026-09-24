import { defineConfig } from 'vitest/config';

// Repo-root test runner. Tests live in ./tests and may import plain-JS logic
// from each of the four sub-projects (backend CJS utils, the three frontends'
// shared buildSlides.js, admin utils). React components are NOT covered here —
// these are pure-logic tests (no DOM rendering beyond jsdom's localStorage).
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage',
      include: [
        'backend/utils/**/*.js',
        'backend/controllers/**/*.js',
        'backend/middleware/**/*.js',
        'frontend-admin/src/utils/**/*.js',
        'frontend-slideshow/src/utils/buildSlides.js',
        'frontend-quizzer/src/utils/buildSlides.js',
      ],
      exclude: ['backend/utils/database-seed.js'],
    },
  },
});
