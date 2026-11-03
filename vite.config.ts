import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/** Keep the browser's Host: the API rejects requests whose Origin does not match it. */
const api = { target: `http://127.0.0.1:${process.env.PORT ?? 8787}`, changeOrigin: false };

/**
 * Cross-origin isolation enables SharedArrayBuffer, which multi-threaded WASM (onnxruntime-web
 * for Whisper) needs. Set in middleware rather than `server.headers`, which Vite leaves off its
 * 304 responses: a revalidated worker script without COEP is blocked. "credentialless" still
 * allows CORS model downloads.
 */
const crossOriginIsolation: Plugin = {
  name: 'cross-origin-isolation',
  configureServer(server) {
    server.middlewares.use((_req, res, next) => {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
      next();
    });
  },
};

export default defineConfig({
  plugins: [react(), crossOriginIsolation],
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    proxy: { '/api': api, '/media': api, '/fonts': api },
  },
  build: { outDir: 'dist', sourcemap: true },
});
