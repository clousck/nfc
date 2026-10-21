import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// UI del panel. En desarrollo: `pnpm dev` (API en :3000) + `pnpm dev:web` (Vite en :5173).
export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: '../dist/public',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
