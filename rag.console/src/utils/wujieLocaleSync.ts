// 由 cw2pc-workspace/scripts/sync-i18n.mjs 分发，勿手改（docs/09 §5）
// wujie 子应用语言联动：iframe 沙箱与主 console 同源共享 localStorage(umi_locale)，
// 新挂载时 plugin-locale 自然读到主应用语言；本模块为保活中的子应用补实时跟随。
// 主控制台 SelectLang 的 setLocale 写入 umi_locale → storage 事件广播到其他同源窗口（含子 iframe）。
import { getLocale, setLocale } from '@umijs/max'

const VALID = new Set(['zh-CN', 'en-US'])

if ((window as any).__POWERED_BY_WUJIE__) {
    const sync = () => {
        const v = localStorage.getItem('umi_locale')
        if (VALID.has(v || '') && v !== getLocale()) setLocale(v as string, false)
    }
    sync()
    window.addEventListener('storage', (e) => { if (e.key === 'umi_locale') sync() })
}
