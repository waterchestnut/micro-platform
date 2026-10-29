// 由 cw2pc-workspace/scripts/sync-brand.mjs 分发，勿手改
export interface ThemePack {
  id: string
  name?: string
  antd?: {token?: Record<string, string>}
  layout?: {colorPrimary?: string; token?: Record<string, any>}
  cssVars?: Record<string, string>
  pdfEngine?: Record<string, string>
  logoIris?: string
  hasAssetOverride?: boolean
}
