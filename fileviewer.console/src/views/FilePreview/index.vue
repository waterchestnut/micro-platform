<script setup lang="ts">
import {ref, onMounted, nextTick, watch} from 'vue'
import {useRoute} from 'vue-router'
import {getAccessToken} from '@/utils/authority'
import {FileViewerLifecycleContext} from '@flyfish-group/file-viewer3'
import {init as initPptxPreview} from 'pptx-preview'

interface ViewerCapabilities {
  download: boolean
  print: boolean
  exportHtml: boolean
}

const route = useRoute()
const url = ref<string>()
const file = ref<File>()
const viewerRef = ref<any>()
const capabilities = ref<ViewerCapabilities>({download: false, print: false, exportHtml: false})
const fileContext = ref<FileViewerLifecycleContext>()
const downloading = ref(false)
const downloadError = ref<string>()

const isPptx = ref(false)
const pptxContainerRef = ref<HTMLDivElement>()
const pptxViewer = ref<any>(null)
const pptxLoading = ref(false)

function isPptxFileName(name: string): boolean {
  try {
    const path = new URL(name).pathname
    return /\.pptx$/i.test(path)
  } catch {
    return /\.pptx$/i.test(name)
  }
}

async function handlePptxPreview(newUrl?: string, newFile?: File) {
  if (!newUrl && !newFile) {
    isPptx.value = false
    return
  }
  const isPptxFile = newUrl ? isPptxFileName(newUrl) : !!(newFile && isPptxFileName(newFile.name))
  if (!isPptxFile) {
    isPptx.value = false
    return
  }
  pptxLoading.value = true
  isPptx.value = true
  try {
    let buffer: ArrayBuffer
    if (newUrl) {
      const resp = await fetch(newUrl)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      buffer = await resp.arrayBuffer()
    } else {
      buffer = await newFile!.arrayBuffer()
    }
    await nextTick()
    if (pptxContainerRef.value) {
      pptxViewer.value = initPptxPreview(pptxContainerRef.value, {width: 960, height: 540, mode: 'list'})
      pptxViewer.value.preview(buffer)
    }
  } catch (e) {
    console.error('PPTX 预览失败:', e)
    isPptx.value = false
  } finally {
    pptxLoading.value = false
  }
}

function logViewerMethods() {
  nextTick(() => {
    if (viewerRef.value) {
      const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(viewerRef.value))
      const own = Object.keys(viewerRef.value)
      const all = [...new Set([...own, ...proto])].filter(k => typeof viewerRef.value[k] === 'function')
    }
  })
}

watch([url, file], ([newUrl, newFile]) => {
  logViewerMethods()
  handlePptxPreview(newUrl, newFile)
})

function handleAction(method: 'downloadOriginalFile' | 'printRenderedHtml' | 'exportRenderedHtml') {
  viewerRef.value?.[method]?.()
}

function handlePptxDownload() {
  if (url.value) {
    const a = document.createElement('a')
    a.href = url.value
    a.download = extractFileNameFromUrl(url.value) || 'presentation.pptx'
    a.target = '_blank'
    a.click()
  } else if (file.value) {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(file.value)
    a.download = file.value.name
    a.click()
    URL.revokeObjectURL(a.href)
  }
}

const options = {
  toolbar: false,
  watermark: {
    text: 'FoLeaC',
    opacity: 0.14,
  },
  hooks: {
    onLoadStart(context: FileViewerLifecycleContext) {
      //console.log('开始加载', context.type, context.filename, context)
    },
    onLoadComplete(context: FileViewerLifecycleContext) {
      //console.log('加载完成', context.duration, context)
      fileContext.value = context

      const avail = viewerRef.value?.getOperationAvailability?.()
      if (avail) {
        capabilities.value = avail
        //console.log('operation availability:', avail)
      }
    },
    onUnloadStart(context: FileViewerLifecycleContext) {
      //console.log('开始卸载', context.reason)
    },
    onUnloadComplete(context: FileViewerLifecycleContext) {
      //console.log('卸载完成', context.filename)
    }
  },
}

function buildDocApiUrl(fileCode: string, fileName: string): string {
  const base = window.DOC_API_BASE
  const token = getAccessToken()
  let fullUrl = `${base}/file/download/${encodeURIComponent(fileName)}?fileCode=${fileCode}`
  if (token) {
    fullUrl += `&accessToken=${token}`
  }
  return fullUrl
}

function getFileNameFromHeaders(headers: Headers): string | null {
  const disposition = headers.get('content-disposition')
  if (!disposition) return null
  const match = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"'\s;]+)/i)
  return match ? decodeURIComponent(match[1]) : null
}

function hasFileNameInUrl(input: string): boolean {
  try {
    const path = new URL(input).pathname
    const segment = path.split('/').filter(Boolean).pop() || ''
    return /\.\w+$/.test(segment)
  } catch {
    return false
  }
}

function extractFileNameFromUrl(input: string): string | null {
  try {
    const path = new URL(input).pathname
    const segment = path.split('/').filter(Boolean).pop() || ''
    return segment || null
  } catch {
    return null
  }
}

async function downloadAsBlob(url: string): Promise<void> {
  downloading.value = true
  downloadError.value = undefined
  try {
    const resp = await fetch(url)
    if (!resp.ok) {
      downloadError.value = `文件下载失败（${resp.status}）`
      return
    }
    const blob = await resp.blob()
    const name = getFileNameFromHeaders(resp.headers) || extractFileNameFromUrl(url) || 'file'
    file.value = new File([blob], name, {type: blob.type})
  } catch {
    downloadError.value = '文件下载失败，请检查网络后重试'
  } finally {
    downloading.value = false
  }
}

function getFileCodeDownloadUrl(fileCode: string): string {
  const base = window.DOC_API_BASE
  const token = getAccessToken()
  let fullUrl = `${base}/file/download/?fileCode=${fileCode}`
  if (token) {
    fullUrl += `&accessToken=${token}`
  }
  return fullUrl
}

onMounted(() => {
  const fileUrl = route.query.url as string | undefined
  const fileCodeParam = route.params.fileCode as string | undefined
  const fileCodeQuery = route.query.fileCode as string | undefined
  const fileName = route.query.fileName as string | undefined

  if (fileUrl) {
    const decoded = decodeURIComponent(fileUrl)
    if (hasFileNameInUrl(decoded)) {
      url.value = decoded
    } else {
      downloadAsBlob(decoded)
    }
  } else {
    const fc = fileCodeParam || fileCodeQuery
    if (!fc) return
    if (fileName) {
      url.value = buildDocApiUrl(fc, fileName)
    } else {
      downloadAsBlob(getFileCodeDownloadUrl(fc))
    }
  }
})
</script>

<template>
  <div class="file-preview">
    <div v-if="downloading" class="loading-state">
      <div class="spinner"></div>
      <p>正在下载文件，请稍候…</p>
    </div>
    <div v-else-if="downloadError" class="error-state">
      <p class="error-icon">!</p>
      <p>{{ downloadError }}</p>
    </div>
    <div v-else-if="url || file" class="viewer-wrapper">
      <div v-if="isPptx" ref="pptxContainerRef" class="pptx-container">
        <div v-if="pptxLoading" class="loading-state">
          <div class="spinner"></div>
          <p>正在加载 PPTX 文件…</p>
        </div>
      </div>
      <template v-else>
        <file-viewer ref="viewerRef" v-if="url" :url="url" :options="options"/>
        <file-viewer ref="viewerRef" v-else :file="file" :options="options"/>
      </template>
      <div class="action-bar">
        <button v-if="capabilities.download || isPptx" class="action-btn btn-download"
                :title="`下载原文件（${isPptx ? (file?.name || extractFileNameFromUrl(url!) || '') : fileContext?.filename}）`"
                @click="isPptx ? handlePptxDownload() : handleAction('downloadOriginalFile')">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        </button>
        <button v-if="capabilities.print" class="action-btn btn-print" title="打印"
                @click="handleAction('printRenderedHtml')">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 6 2 18 2 18 9"/>
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
            <rect x="6" y="14" width="12" height="8"/>
          </svg>
        </button>
        <button v-if="capabilities.exportHtml" class="action-btn btn-export" title="导出HTML"
                @click="handleAction('exportRenderedHtml')">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round">
            <polyline points="16 3 21 3 21 8"/>
            <line x1="4" y1="20" x2="21" y2="3"/>
            <polyline points="21 16 21 21 16 21"/>
            <line x1="15" y1="15" x2="21" y2="21"/>
            <line x1="4" y1="4" x2="9" y2="9"/>
          </svg>
        </button>
      </div>
    </div>
    <div v-else class="empty-state">
      <p>请提供文件链接或资源编码</p>
      <p class="hint">示例: /preview/?url=https://example.com/file.docx 或 /preview/{fileCode}?fileName=xxx</p>
    </div>
  </div>
</template>

<style scoped>
.file-preview {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.viewer-wrapper {
  flex: 1;
  overflow: hidden;
}

.pptx-container {
  width: 100%;
  height: 100%;
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #999;
  font-size: 16px;
}

.hint {
  margin-top: 8px;
  font-size: 13px;
  color: #bbb;
}

.action-bar {
  position: fixed;
  bottom: 24px;
  right: 24px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 1000;
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 50%;
  color: #fff;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  transition: background 0.2s;
}

.btn-download {
  background: var(--brand-primary, #916E40);
}

.btn-download:hover {
  background: #246e50;
}

.btn-print {
  background: #1890ff;
}

.btn-print:hover {
  background: #096dd9;
}

.btn-export {
  background: #fa8c16;
}

.btn-export:hover {
  background: #d46b08;
}

.loading-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: #999;
  font-size: 15px;
}

.spinner {
  width: 36px;
  height: 36px;
  border: 3px solid #e0e0e0;
  border-top-color: var(--brand-primary, #916E40);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.error-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: #999;
  font-size: 15px;
}

.error-icon {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: #ff4d4f;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  font-weight: bold;
}
</style>
