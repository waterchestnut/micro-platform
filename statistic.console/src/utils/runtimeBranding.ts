/**
 * 运行期品牌注入：部署级 Deployment env（APP_TITLE/APP_LOGO）经镜像启动脚本 99-modify-config.sh
 * 替换 index.html 中 baked 的 CW2PC_* 占位符而来。未注入（占位符残留/空值，含本地 dev）时返回空对象，
 * 走 defaultSettings 烤死值；仅在真有值时才回传对应键，避免 {title:undefined} 覆盖掉既有标题。
 */
const clean = (v: unknown) => (typeof v === 'string' && v && !v.startsWith('CW2PC_') ? v : undefined)

export function getRuntimeBranding(): {title?: string; logo?: string} {
    const title = clean((window as any).APP_TITLE)
    const logo = clean((window as any).APP_LOGO)
    if (title) document.title = title
    const branding: {title?: string; logo?: string} = {}
    if (title) branding.title = title
    if (logo) branding.logo = logo
    return branding
}

/** 页脚备案号/版权的部署级覆盖：与 APP_TITLE 同占位符通道（Deployment env APP_ICP/APP_COPYRIGHT） */
export function getRuntimeFooter(): {icp?: string; copyrightHolder?: string} {
    const branding: {icp?: string; copyrightHolder?: string} = {}
    const icp = clean((window as any).APP_ICP)
    const holder = clean((window as any).APP_COPYRIGHT)
    if (icp) branding.icp = icp
    if (holder) branding.copyrightHolder = holder
    return branding
}
