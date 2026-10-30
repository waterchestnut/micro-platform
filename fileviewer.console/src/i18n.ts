// fileviewer 轻量 i18n（docs/09）：zh-CN/en-US；解析优先级 ?lang= > localStorage > 浏览器语言
import { ref, computed } from 'vue'

export const LANG_KEY = 'app_locale'
const dict: Record<string, [string, string]> = {
  'upload.pickHint': ['点击选择文件或将文件拖拽到此区域', 'Click to choose a file, or drag it here'],
  'upload.formats': ['支持 Office、PDF、图片、音视频等常见格式', 'Supports Office, PDF, images, audio/video and other common formats'],
  'upload.rechoose': ['重新选择', 'Choose again'],
  'viewer.pptxLoading': ['正在加载 PPTX 文件…', 'Loading PPTX file…'],
  'preview.downloading': ['正在下载文件，请稍候…', 'Downloading file, please wait…'],
  'preview.needSource': ['请提供文件链接或资源编码', 'Provide a file URL or resource code'],
  'preview.example': [
    '示例: /preview/?url=https://example.com/file.docx 或 /preview/{fileCode}?fileName=xxx',
    'Example: /preview/?url=https://example.com/file.docx or /preview/{fileCode}?fileName=xxx',
  ],
}

function resolveLang(): string {
  const q = new URLSearchParams(window.location.search).get('lang')
  if (q === 'en-US' || q === 'zh-CN') return q
  if (isEmbedded()) {                              // 嵌入态：跟随主 console（同源共享 umi_locale），不显示自己的切换
    const m = localStorage.getItem('umi_locale')
    if (m === 'en-US' || m === 'zh-CN') return m
  }
  const s = localStorage.getItem(LANG_KEY)
  if (s === 'en-US' || s === 'zh-CN') return s
  const env = (window as any).APP_LANG   // 部署级缺省语言（vite 注入，可选）
  if (env === 'en-US' || env === 'zh-CN') return env
  return String(navigator.language || 'zh-CN').toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'
}

export const isEmbedded = () => !!(window as any).__POWERED_BY_WUJIE__

const lang = ref(resolveLang())

// 嵌入态实时跟随主应用语言（storage 事件，docs/09 §4）；独立态由本应用 toggle 自控
window.addEventListener('storage', (e) => {
  if (isEmbedded() && e.key === 'umi_locale' && (e.newValue === 'en-US' || e.newValue === 'zh-CN')) {
    lang.value = e.newValue
  }
})

export function useI18n() {
  const t = (key: string) => {
    const e = dict[key]
    if (!e) return key
    return lang.value === 'en-US' ? e[1] : e[0]
  }
  const toggle = () => {
    lang.value = lang.value === 'zh-CN' ? 'en-US' : 'zh-CN'
    localStorage.setItem(LANG_KEY, lang.value)
  }
  return { lang: computed(() => lang.value), t, toggle }
}
