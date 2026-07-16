import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(() => {
  return {
    base: './', // Ensures assets load correctly on any path
    plugins: [react()],
    server: {
      watch: {
        // Coordination worktrees churn (.claude/worktrees/*) must not trigger dev reloads.
        ignored: ['**/.claude/**'],
      },
    },
    test: {
      // Keep coordination worktrees (.claude/worktrees/*) out of the test run.
      exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**'],
    },
    // NOTE: We intentionally do NOT inject API_KEY into the frontend.
    // The Gemini API key lives ONLY server-side in netlify/functions/genai-proxy.js.
    // The frontend calls the proxy; the key is never shipped to the browser.
    build: {
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          manualChunks: {
            // Split React vendor bundle from app code
            'react-vendor': ['react', 'react-dom'],
            'icons': ['lucide-react'],
          },
        },
      },
    },
  }
})
