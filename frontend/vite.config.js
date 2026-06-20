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
    // Only proxy backend API routes (/api/...), not frontend modules like apiClient.js
    proxy: {
      '/api/': {
        target: 'http://backend:5000',
        changeOrigin: true,
      }
    }
  }
})