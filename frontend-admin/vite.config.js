import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, createReadStream } from 'fs';
import { createRequire } from 'module';

// __dirname is unavailable in ESM; derive it from import.meta.url so that
// `root` resolves to this file's directory regardless of the launch CWD.
const _dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// ffmpeg.wasm's worker loads the UMD core via importScripts, but the package's
// `exports` map hides the deep dist/umd path from bundlers. This plugin copies
// the UMD core + wasm to a stable served path (/ffmpeg/*) — emitted into the
// production build and served by middleware in dev — so VideoEditor can load
// them with toBlobURL offline, no CDN.
function ffmpegCore() {
  const umdJs = require.resolve('@ffmpeg/core');      // .../dist/umd/ffmpeg-core.js
  const wasm  = join(dirname(umdJs), 'ffmpeg-core.wasm');
  return {
    name: 'ffmpeg-core-copy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/ffmpeg/ffmpeg-core.js')   { res.setHeader('Content-Type', 'text/javascript'); createReadStream(umdJs).pipe(res); return; }
        if (req.url === '/ffmpeg/ffmpeg-core.wasm')  { res.setHeader('Content-Type', 'application/wasm'); createReadStream(wasm).pipe(res); return; }
        next();
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'ffmpeg/ffmpeg-core.js',   source: readFileSync(umdJs) });
      this.emitFile({ type: 'asset', fileName: 'ffmpeg/ffmpeg-core.wasm', source: readFileSync(wasm) });
    }
  };
}

export default defineConfig({
  root: _dirname,
  plugins: [react(), ffmpegCore()],
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
  },
  // ffmpeg.wasm ships an ESM worker + wasm core; excluding it from dep
  // pre-bundling avoids Vite rewriting the worker/import.meta.url paths.
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util']
  }
});
