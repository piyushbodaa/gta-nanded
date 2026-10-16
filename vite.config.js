import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // The OSM snapshot is data, cached separately from the small game code bundle.
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      output: { manualChunks: { three: ['three'], 'street-map': ['./src/data/network.json'], places: ['./src/data/city.json'] } },
    },
  },
});
