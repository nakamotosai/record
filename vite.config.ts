import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    electron([
      {
        // Main process entry point
        entry: 'electron/main.ts',
        onstart(args) {
          args.startup()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              // 原生模块必须作为外部依赖，不能被打包
              external: ['electron', 'node-screenshots']
            }
          }
        }
      },
      {
        // Preload script entry point
        entry: 'electron/preload.ts',
        onstart(options) {
          options.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron', 'node-screenshots']
            }
          }
        }
      }
    ]),
    renderer()
  ],
  build: {
    rollupOptions: {
      input: {
        main: './index.html'
      }
    }
  }
})
