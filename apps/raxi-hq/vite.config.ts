import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: { pixi: ['pixi.js'], react: ['react', 'react-dom'] },
      },
    },
  },
  server: {
    port: 5174,
  },
});
