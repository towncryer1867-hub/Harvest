import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 3030,
    strictPort: true,
    host: '0.0.0.0',
    watch: {
      usePolling: true
    },
    // Proxy configuration routes backend queries to the correct Node container pipeline
    proxy: {
      '/api': {
        target: 'http://backend:5000',
        changeOrigin: true,
      }
    }
  }
})