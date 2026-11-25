import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          '@deepseek-ai/cordis',
          '@deepseek-ai/dsh-client-connection',
          '@deepseek-ai/dsh-typert-registry',
          '@deepseek-ai/dsh-api-gateway',
          '@deepseek-ai/dsh-api-session-controller',
          '@deepseek-ai/dsh-api-workspace-controller',
          '@deepseek-ai/dsh-typert-protocol',
          '@deepseek-ai/dsh-deque',
          'zod'
        ]
      })
    ],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          pet: resolve(__dirname, 'src/preload/pet.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          pet: resolve(__dirname, 'src/renderer/pet.html')
        }
      }
    }
  }
})