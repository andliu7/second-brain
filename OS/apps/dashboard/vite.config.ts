import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages project site: https://andliu7.github.io/dashboard/
export default defineConfig({
  plugins: [react()],
  base: '/dashboard/',
})
