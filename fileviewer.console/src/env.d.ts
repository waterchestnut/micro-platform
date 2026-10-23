/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

interface Window {
  __POWERED_BY_WUJIE__?: boolean
  $wujie?: {
    props: Record<string, unknown>
  }
  UCENTER_API_BASE?: string
  UCENTER_PLATFORM_BASE?: string
  DOC_API_BASE?: string
}
