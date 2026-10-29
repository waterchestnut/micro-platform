// 由 cw2pc-workspace/scripts/sync-brand.mjs 分发，勿手改（docs/08 §5.1）
// 优先级链：显式 env（APP_LOGO/APP_TITLE）＞ 主题包（APP_THEME）＞ 烘焙默认值
import type {Settings as LayoutSettings} from '@ant-design/pro-components'
import {DEFAULT_THEME_ID, THEMES} from '@/themes/generated'
import type {ThemePack} from '@/themes/types'

export type {ThemePack}

const isPlaceholder = (v: unknown) =>
    typeof v === 'string' && (!v || v.startsWith('CW2PC_') || v.startsWith('XXZX_'))

export function resolveThemeId(): string {
    const raw = (window as any).APP_THEME
    if (typeof raw !== 'string' || isPlaceholder(raw)) return DEFAULT_THEME_ID
    if (!THEMES[raw]) {
        console.warn(`[brand] 未知主题 '${raw}'，回落缺省包 ${DEFAULT_THEME_ID}`)
        return DEFAULT_THEME_ID
    }
    return raw
}

export function getTheme(): ThemePack {
    return THEMES[resolveThemeId()]
}

const isPlain = (v: any) => v && typeof v === 'object' && !Array.isArray(v)
const hexToRgb = (hex: string): string | null => {
    const n = hex.replace('#', '')
    if (!/^([0-9a-f]{6}){1,2}$/i.test(n)) return null
    return [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16)).join(', ')
}
export function deepMerge<T extends Record<string, any>>(base: T, patch?: any): T {
    if (!isPlain(patch)) return base
    const out: any = {...base}
    for (const k of Object.keys(patch)) {
        const v = patch[k]
        if (v === undefined) continue
        out[k] = isPlain(v) && isPlain(base?.[k]) ? deepMerge(base[k], v) : v
    }
    return out
}

let domDone = false
/** 一次性 DOM 副作用：CSS 变量（brand.css 的冗余通道，幂等）+ favicon 兜底指向 */
export function applyThemeDomOnce() {
    if (domDone || typeof document === 'undefined') return
    domDone = true
    const t = getTheme()
    const vars: Record<string, string> = {...(t.cssVars || {})}
    if (vars['--brand-primary'] && !vars['--brand-primary-rgb']) {
        const rgb = hexToRgb(vars['--brand-primary'])
        if (rgb) vars['--brand-primary-rgb'] = rgb
    }
    for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v)
    if (t.hasAssetOverride) {
        const id = resolveThemeId()
        document.querySelectorAll<HTMLLinkElement>('link[rel*="icon"]')
            .forEach(l => { l.href = `/themes/${id}/favicon.svg` })
    }
}

/** ProLayout 设置：defaultSettings 深合并主题 layout 节（无条件合并，docs/08 §12.5 语义） */
export function themeLayoutSettings(base: Partial<LayoutSettings>): Partial<LayoutSettings> {
    applyThemeDomOnce()
    const t = getTheme()
    return deepMerge(base, {colorPrimary: t.layout?.colorPrimary, token: t.layout?.token})
}
