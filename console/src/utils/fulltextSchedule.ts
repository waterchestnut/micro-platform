import { getFulltextSchedule, ScheduleResult } from '@/services/resource/fulltext'

const MAX_CACHE_SIZE = 1000
const cache = new Map<string, ScheduleResult[]>()

function cacheGet(resCode: string): ScheduleResult[] | undefined {
  return cache.get(resCode)
}

function cacheSet(resCode: string, results: ScheduleResult[]) {
  if (cache.size >= MAX_CACHE_SIZE) {
    const oldestKey = cache.keys().next().value
    if (oldestKey) {
      cache.delete(oldestKey)
    }
  }
  cache.set(resCode, results)
}

export interface FulltextScheduleOptions {
  onScheduling?: () => void
  onScheduled?: () => void
  onResult?: (results: ScheduleResult[]) => void
}

export interface FulltextScheduleResult {
  lci: ScheduleResult | undefined
  oa: ScheduleResult | undefined
  dds: ScheduleResult | undefined
  ppv: ScheduleResult | undefined
  ill: ScheduleResult | undefined
  original: ScheduleResult | undefined
}

export function groupResultsByType(results: ScheduleResult[]): FulltextScheduleResult {
  const grouped: FulltextScheduleResult = {
    lci: undefined,
    oa: undefined,
    dds: undefined,
    ppv: undefined,
    ill: undefined,
    original: undefined,
  }
  results.forEach((r) => {
    if (r.type in grouped) {
      grouped[r.type as keyof FulltextScheduleResult] = r
    }
  })
  return grouped
}

export async function fetchSchedule(
  resCode: string,
  options?: FulltextScheduleOptions,
): Promise<ScheduleResult[]> {
  const cached = cacheGet(resCode)
  if (cached) {
    options?.onResult?.(cached)
    return cached
  }

  options?.onScheduling?.()

  try {
    const results = await getFulltextSchedule([resCode])
    cacheSet(resCode, results)
    options?.onResult?.(results)
    return results
  } finally {
    options?.onScheduled?.()
  }
}

export async function fetchScheduleBatch(
  resCodeList: string[],
  options?: FulltextScheduleOptions,
): Promise<Map<string, ScheduleResult[]>> {
  const resultMap = new Map<string, ScheduleResult[]>()
  const uncachedList: string[] = []

  resCodeList.forEach((resCode) => {
    const cached = cacheGet(resCode)
    if (cached) {
      resultMap.set(resCode, cached)
    } else {
      uncachedList.push(resCode)
    }
  })

  if (uncachedList.length === 0) {
    return resultMap
  }

  options?.onScheduling?.()

  try {
    const results = await getFulltextSchedule(uncachedList)
    const groupedByResCode = new Map<string, ScheduleResult[]>()
    results.forEach((r) => {
      if (!groupedByResCode.has(r.resCode)) {
        groupedByResCode.set(r.resCode, [])
      }
      groupedByResCode.get(r.resCode)!.push(r)
    })

    uncachedList.forEach((resCode) => {
      const items = groupedByResCode.get(resCode) || []
      cacheSet(resCode, items)
      resultMap.set(resCode, items)
    })

    return resultMap
  } finally {
    options?.onScheduled?.()
  }
}

export function getCachedSchedule(resCode: string): ScheduleResult[] | undefined {
  return cacheGet(resCode)
}

export function clearScheduleCache() {
  cache.clear()
}