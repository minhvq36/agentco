import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

/**
 * Build ra `web/dist`, daemon phục vụ tĩnh từ đó. → docs/SPEC-ui.md §0
 *
 * `base: './'` để bundle chạy được dù daemon phục vụ ở đường dẫn nào.
 * Dev: `npm run dev:web` chạy Vite ở 5173 và proxy /api sang daemon 7317 —
 * nhờ vậy sửa UI không phải build lại backend.
 */
export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Một app localhost: chia nhỏ chunk chỉ thêm round-trip, không thêm gì.
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:7317', changeOrigin: true, ws: false },
      '/healthz': { target: 'http://127.0.0.1:7317', changeOrigin: true },
    },
  },
});
