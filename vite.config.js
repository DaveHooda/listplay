import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    react()
  ],
  build: {
    rollupOptions: {
      input: resolve(__dirname, 'src/popup.html'),
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name][extname]'
      },
    },
    outDir: 'dist',
    emptyOutDir: true,
  },
});
