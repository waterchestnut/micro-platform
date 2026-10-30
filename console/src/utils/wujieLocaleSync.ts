// 由 cw2pc-workspace/scripts/sync-i18n.mjs 分发，勿手改（docs/09 §4）
// wujie 子应用语言联动：iframe 沙箱与主 console 同源共享 localStorage(umi_locale)。
// 注意：plugin-locale 的 getLocale/setLocale 依赖 umi 插件容器（applyPlugins），entry 模块求值期不可调用——
// 首启同步推迟到 DOMContentLoaded（umi render 已执行完），storage 事件回调天然在启动后。
import { getLocale, setLocale } from '@umijs/max'

const VALID = new Set(['zh-CN', 'en-US'])

if ((window as any).__POWERED_BY_WUJIE__) {
    const sync = () => {
        try {
            const v = localStorage.getItem('umi_locale')
            if (VALID.has(v || '') && v !== getLocale()) setLocale(v as string, false)
        } catch (e) { /* 容器未就绪时静默，storage 事件仍会兜住后续变更 */ }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', sync, {once: true})
    } else {
        sync()
    }
    window.addEventListener('storage', (e) => { if (e.key === 'umi_locale') sync() })
}
