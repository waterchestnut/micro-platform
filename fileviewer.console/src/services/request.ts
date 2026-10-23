export interface ResponseStructure<T = any> {
  code: number
  data?: T
  msg?: string
}

export async function ucenterRequest<T>(relativeUrl: string, options?: RequestInit): Promise<ResponseStructure<T>> {
  const base = (window as any).UCENTER_API_BASE || 'http://localhost:12001'
  const resp = await fetch(`${base}${relativeUrl}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })
  return resp.json()
}
