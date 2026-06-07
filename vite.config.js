import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    open: true,
    host: true,
    port: 3000,
  },
  assetsInclude: ['**/*.vrm'],
  build: {
    target: 'esnext',
  },
});
