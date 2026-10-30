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
  /* 部署级品牌 env（CW2PC_* 占位符由容器启动 99-modify-config.sh 按 Deployment env 替换，docs/08 §9） */
  window.APP_TITLE='${env.APP_TITLE || 'CW2PC_APP_TITLE'}';
  window.APP_LOGO='${env.APP_LOGO || 'CW2PC_APP_LOGO'}';
  window.APP_THEME='${env.APP_THEME || 'CW2PC_APP_THEME'}';
  window.APP_LANG='${env.APP_LANG || ''}';
  document.addEventListener('DOMContentLoaded', function () {
    var t = window.APP_TITLE;
    if (typeof t === 'string' && t && !t.startsWith('CW2PC_')) document.title = t;
  });
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
