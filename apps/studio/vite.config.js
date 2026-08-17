import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../../packages/api/studio-dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});
