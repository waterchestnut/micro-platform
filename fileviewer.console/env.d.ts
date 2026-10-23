/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly PORT?: string
  readonly API_BASE?: string
  readonly UCENTER_API_BASE?: string
  readonly UCENTER_PLATFORM_BASE?: string
  readonly DOC_API_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
