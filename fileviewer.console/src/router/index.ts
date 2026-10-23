import { createRouter, createWebHistory } from 'vue-router'
import FilePreview from '@/views/FilePreview/index.vue'
import LocalUpload from '@/views/LocalUpload/index.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      redirect: '/upload',
    },
    {
      path: '/preview',
      name: 'FilePreview',
      component: FilePreview,
    },
    {
      path: '/preview/:fileCode',
      name: 'FilePreviewByCode',
      component: FilePreview,
    },
    {
      path: '/upload',
      name: 'LocalUpload',
      component: LocalUpload,
    },
  ],
})

export default router
