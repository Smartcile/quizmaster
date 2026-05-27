import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// __dirname is unavailable in ESM; derive it from import.meta.url so that
// `root` resolves to this file's directory regardless of the launch CWD.
const _dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: _dirname,
  plugins: [react()],
  server: {
    port: 3001,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
});
