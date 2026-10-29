<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { isEmbedded } from '@/utils/embed'
import { init as initPptxPreview } from 'pptx-preview'

const file = ref<File>()
const dragging = ref(false)

const isPptx = ref(false)
const pptxContainerRef = ref<HTMLDivElement>()
const pptxLoading = ref(false)

watch(file, async (f) => {
  if (!f || !/\.pptx$/i.test(f.name)) {
    isPptx.value = false
    return
  }
  pptxLoading.value = true
  isPptx.value = true
  try {
    const buffer = await f.arrayBuffer()
    await nextTick()
    if (pptxContainerRef.value) {
      const viewer = initPptxPreview(pptxContainerRef.value, { width: 960, height: 540 })
      viewer.preview(buffer)
    }
  } catch (e) {
    console.error('PPTX 预览失败:', e)
    isPptx.value = false
  } finally {
    pptxLoading.value = false
  }
})

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.item(0)
  if (f) file.value = f
}

function onDrop(e: DragEvent) {
  dragging.value = false
  const f = e.dataTransfer?.files?.item(0)
  if (f) file.value = f
}
</script>

<template>
  <div class="upload-page">
    <div v-if="!file" class="upload-area"
      :class="{ dragging }"
      @dragenter.prevent="dragging = true"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
    >
      <input type="file" class="file-input" @change="onFileChange" />
      <div class="upload-hint">
        <p class="upload-icon">+</p>
        <p>点击选择文件或将文件拖拽到此区域</p>
        <p class="upload-desc">支持 Office、PDF、图片、音视频等常见格式</p>
      </div>
    </div>
    <div v-else class="preview-area">
      <div class="file-info">
        <span class="file-name">{{ file.name }}</span>
        <span class="file-size">（{{ (file.size / 1024 / 1024).toFixed(2) }} MB）</span>
        <button class="rechoose-btn" @click="file = undefined">重新选择</button>
      </div>
      <div class="viewer-wrapper">
        <div v-if="isPptx" ref="pptxContainerRef" class="pptx-container">
          <div v-if="pptxLoading" class="loading-state">
            <div class="spinner"></div>
            <p>正在加载 PPTX 文件…</p>
          </div>
        </div>
        <file-viewer v-else :file="file" :options="{ toolbar: true }" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.upload-page {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.upload-area {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  margin: 24px;
  border: 2px dashed #d9d9d9;
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
}

.upload-area:hover,
.upload-area.dragging {
  border-color: var(--brand-primary, #916E40);
  background: #f6ffed;
}

.file-input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.upload-hint {
  text-align: center;
  color: #999;
  pointer-events: none;
}

.upload-icon {
  font-size: 48px;
  color: #d9d9d9;
  line-height: 1;
  margin-bottom: 8px;
}

.upload-desc {
  font-size: 13px;
  margin-top: 4px;
  color: #bbb;
}

.preview-area {
  flex: 1;
}

.file-info {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-bottom: 1px solid #f0f0f0;
  font-size: 14px;
}

.file-name {
  font-weight: 500;
  color: #333;
}

.file-size {
  color: #999;
}

.rechoose-btn {
  margin-left: auto;
  padding: 4px 12px;
  border: 1px solid #d9d9d9;
  border-radius: 4px;
  background: #fff;
  color: #666;
  font-size: 13px;
  cursor: pointer;
}

.rechoose-btn:hover {
  border-color: var(--brand-primary, #916E40);
  color: var(--brand-primary, #916E40);
}

.viewer-wrapper {
  flex: 1;
  height: calc(100vh - 45px);
}

.pptx-container {
  width: 100%;
  height: 100%;
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
}

.loading-state {
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
</style>
