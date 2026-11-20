/**
 * 菜单语言兜底包：umi plugin-locale 的 react-intl 桥接在 pro3/max4.7 组合下运行时读取失效
 * （bundle 内 zh/en 对象俱在、页面仍渲染 raw name），此处直接 import 语言包源文件，
 * 经 menuDataRender 按 pro-layout 的键规则（menu.<父name>.<子name>）覆盖 name。
 * 后续 plugin-locale 桥接修复后可整体移除本文件与 app.tsx 中的 menuDataRender。
 */
import zhMenu from '@/locales/zh-CN/menu'
import enMenu from '@/locales/en-US/menu'

const currentLang = (): string => {
  let v = ''
  try {
    v = localStorage.getItem('umi_locale') || ''
  } catch (e) { /* 隐私模式读取异常忽略 */ }
  if (v !== 'zh-CN' && v !== 'en-US') {
    v = (navigator.language || '').toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'
  }
  return v
}

/** 返回给 ProLayout 的 menuDataRender：以语言包覆盖 name；未命中键时保留原 name */
export const menuLocalePatch = (menuData: any[]): any[] => {
  const pack: Record<string, string> = (currentLang() === 'en-US' ? enMenu : zhMenu) as any
  const walk = (items: any[], parentKey: string): any[] => (items || []).map(item => {
    // pro-layout 键规则：顶层 menu.<name>，子级 menu.<父name>.<子name>（与 locales 文件键一致）
    const key = parentKey ? `menu.${parentKey}.${item.name}` : `menu.${item.name}`
    const label = pack[key]
    const nextParent = parentKey ? `${parentKey}.${item.name}` : item.name
    return {
      ...item,
      ...(label ? { name: label } : {}),
      ...(item.routes ? { routes: walk(item.routes, nextParent) } : {}),
      ...(item.children ? { children: walk(item.children, nextParent) } : {}),
    }
  })
  return walk(menuData, '')
}
