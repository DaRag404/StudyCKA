import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';

// A classic script also works from file:// (ES modules require an HTTP origin).
export default defineConfig({
  resolve: {
    alias: { 'node:zlib': fileURLToPath(new URL('./src/lab/compression.js', import.meta.url)) },
  },
  base: './',
  plugins: [react()],
  build: {
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'assets/studycka.js',
        assetFileNames: 'assets/studycka.[ext]',
      },
    },
  },
});
