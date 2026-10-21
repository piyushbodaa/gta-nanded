import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    reportCompressedSize: false,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      // Three.js changes less often than the game: cache it separately.
      output: { manualChunks: { three: ['three'] } },
    },
  },
});
