import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react':  ['react', 'react-dom', 'react-router-dom'],
          'vendor-query':  ['@tanstack/react-query'],
          'vendor-charts': ['recharts'],
          'vendor-flow':   ['reactflow', '@dagrejs/dagre'],
          'vendor-dnd':    ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
          'vendor-icons':  ['lucide-react'],
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    watch: {
      usePolling: true,   // required when source is on a Windows host mounted into Docker
      interval: 300,
    },
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://mynet-backend:8000',
        changeOrigin: true,
      },
      '/ws': {
        target: process.env.VITE_WS_URL || 'ws://mynet-backend:8000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
