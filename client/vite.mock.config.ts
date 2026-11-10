// Runs the renderer in a plain browser with a mock `window.wisprram` bridge (see src/renderer/src/mock/).
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared'), '@renderer': resolve(__dirname, 'src/renderer/src') } },
  define: { 'import.meta.env.VITE_MOCK_BRIDGE': JSON.stringify('1') },
  plugins: [react()],
  server: { port: 5199 }
})
