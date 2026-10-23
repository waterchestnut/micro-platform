export function isEmbedded(): boolean {
  return window.__POWERED_BY_WUJIE__ === true
}

export function getEmbeddedProps<T = Record<string, unknown>>(): T | undefined {
  return window.$wujie?.props as T | undefined
}

export function getEmbeddedName(): string {
  return window.name || ''
}
