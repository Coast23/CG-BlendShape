import { defineConfig } from 'vite';

export default defineConfig({
  base: '/CG-BlendShape/',
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
