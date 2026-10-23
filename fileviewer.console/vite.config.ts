import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    base: '/',
    plugins: [
      vue(),
      {
        name: 'inject-env',
        transformIndexHtml: {
          order: 'pre',
          handler() {
            return [
              {
                tag: 'script',
                attrs: { type: 'text/javascript' },
                children: `
  /* 用户中心接口地址 */
  window.UCENTER_API_BASE='${env.UCENTER_API_BASE || 'http://localhost:12001'}';
  /* 用户中心平台地址 */
  window.UCENTER_PLATFORM_BASE='${env.UCENTER_PLATFORM_BASE || 'http://localhost:11002'}';
  /* 文件服务地址 */
  window.DOC_API_BASE='${env.DOC_API_BASE || 'http://localhost:12004'}';
`,
              },
            ]
          },
        },
      },
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      host: '127.0.0.1',
      port: parseInt(env.PORT || '10017'),
      proxy: {
        '/doc': {
          target: env.API_BASE || 'http://127.0.0.1:12004',
          changeOrigin: true,
        },
      },
    },
    css: {
      preprocessorOptions: {
        scss: {},
      },
    },
  }
})
