import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icons/*.png', 'books/*.epub'],
      manifest: {
        name: 'BOOK — ваша библиотека',
        short_name: 'BOOK',
        description: 'Личная библиотека и читалка. Ваши книги всегда рядом, даже без интернета.',
        lang: 'ru',
        start_url: '/',
        scope: '/',
        id: '/',
        display: 'standalone',
        background_color: '#f8f7f3',
        theme_color: '#f8f7f3',
        orientation: 'any',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,epub}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          epub: ['epubjs'],
          storage: ['dexie', 'dexie-react-hooks'],
        },
      },
    },
  },
});
