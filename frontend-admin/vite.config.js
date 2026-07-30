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

// The core must be the ESM build. @ffmpeg/ffmpeg (0.12.15) always spawns its
// worker with `type: "module"`, where `importScripts()` does not exist — so the
// worker's only working path is `await import(coreURL)`, and a UMD core imported
// as a module exposes no default export ("failed to import ffmpeg-core.js").
// The package's `exports` map hides the deep dist path from bundlers, so copy
// dist/esm/* to a stable served path (/ffmpeg/*) — emitted into the production
// build and served by middleware in dev — for offline toBlobURL loading, no CDN.
function ffmpegCore() {
  // require.resolve honours the "require" condition → dist/umd; step across to esm.
  const esmDir = join(dirname(require.resolve('@ffmpeg/core')), '..', 'esm');
  const coreJs = join(esmDir, 'ffmpeg-core.js');
  const wasm   = join(esmDir, 'ffmpeg-core.wasm');
  return {
    name: 'ffmpeg-core-copy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/ffmpeg/ffmpeg-core.js')   { res.setHeader('Content-Type', 'text/javascript'); createReadStream(coreJs).pipe(res); return; }
        if (req.url === '/ffmpeg/ffmpeg-core.wasm')  { res.setHeader('Content-Type', 'application/wasm'); createReadStream(wasm).pipe(res); return; }
        next();
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'ffmpeg/ffmpeg-core.js',   source: readFileSync(coreJs) });
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
    // Dev-server only (the container serves the nginx build, which proxies these
    // itself). Without /uploads here the SPA fallback answers with index.html
    // and every uploaded image 404s in dev.
    proxy: {
      '/api':      { target: 'http://localhost:5000', changeOrigin: true },
      '/socket.io':{ target: 'http://localhost:5000', changeOrigin: true, ws: true },
      '/uploads':  { target: 'http://localhost:5000', changeOrigin: true }
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
