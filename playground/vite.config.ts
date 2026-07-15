import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // @alp/parser re-exports Node-only modules (LockManager, Memory)
      // that import `fs`/`path`. The playground never instantiates them
      // at runtime, so we point them at browser-safe stubs.
      fs: path.resolve(__dirname, 'src/shims/fs.ts'),
      path: path.resolve(__dirname, 'src/shims/path.ts'),
    },
  },
})
