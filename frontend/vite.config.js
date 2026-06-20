import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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