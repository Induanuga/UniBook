import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Serve index.html for any unknown path so /cas-callback works on refresh
  appType: 'spa',
  test: {
    environment: 'jsdom',
  },
})
