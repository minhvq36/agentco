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
    alias: {
      '@': path.resolve(__dirname, 'src'),
      /**
       * Phép toán bố cục sơ đồ dùng CHUNG với backend. → src/core/layout-geometry.ts
       *
       * Đây là file DUY NHẤT của `src/` mà giao diện được nạp, và nó thuần —
       * không import `node:*`, không đụng đĩa. Hai bản mã của cùng một phép
       * toán đã lệch nhau một lần (văn phòng mới ra sơ đồ méo); import chung
       * thì lỗi đó không xảy ra lại được.
       */
      '@core': path.resolve(__dirname, '../src/core'),
    },
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
