import { defineConfig } from 'vite'

export default defineConfig({
  root: '.',
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        manualChunks: {
          'three-core': ['three'],
        },
      },
    },
  },
  server: {
    port: 5173,
    open: true,
  },
})
