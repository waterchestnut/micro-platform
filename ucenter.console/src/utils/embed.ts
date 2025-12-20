/** 嵌入到其他控制台的判定、操作 */

/** 是否在嵌入到其他平台使用 */
export function isEmbedded() {
  // @ts-ignore
  return window.__POWERED_BY_WUJIE__;
}

export function getEmbeddedProps() {
  // @ts-ignore
  return window.$wujie?.props;
}

export function getEmbeddedName() {
  return window.name || ''
}
