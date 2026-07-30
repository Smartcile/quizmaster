import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3002,
    host: '0.0.0.0',
    // Dev-server only (the container serves the nginx build, which proxies these
    // itself). `backend` is a Docker-network name and never resolves from the
    // host, so target localhost — vite dev is only ever run on the host.
    proxy: {
      '/api':      { target: 'http://localhost:5000', changeOrigin: true },
      '/socket.io':{ target: 'http://localhost:5000', changeOrigin: true, ws: true },
      '/uploads':  { target: 'http://localhost:5000', changeOrigin: true }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
});
