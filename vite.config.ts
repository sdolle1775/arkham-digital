import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  root: 'src/client', plugins: [react()],
  build: { outDir: '../../dist/client', emptyOutDir: true },
  server: { port: 5173, proxy: { '/api': { target: 'http://127.0.0.1:4917', ws: true } } }
});
