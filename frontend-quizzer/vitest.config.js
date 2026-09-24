import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Component tests for the quizzer app (React 18 + Vite 5 → Vitest 2).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.test.{js,jsx}'],
    css: false,
    restoreMocks: true,
  },
});
