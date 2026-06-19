import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // En desarrollo, Vite proxea /api/football/* → football-data.org
    // Esto replica el comportamiento del server.js de producción
    proxy: {
      '/api/football': {
        target: 'https://api.football-data.org/v4',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/football/, ''),
        secure: true,
      },
      '/api/odds': {
        target: 'https://api.the-odds-api.com/v4',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/odds/, ''),
        secure: true,
      },
      '/api/apifootball': {
        target: 'https://v3.football.api-sports.io',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/apifootball/, ''),
        secure: true,
      },
    },
  },
})
