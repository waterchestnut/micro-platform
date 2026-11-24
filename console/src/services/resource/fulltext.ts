import {resourceRequest} from '@/services/request'

export interface ScheduleResult {
  type: string
  links?: { href: string; label?: string }[]
  resCode: string
}

export interface SchedulingResponse {
  code: number
  data?: ScheduleResult[]
  msg?: string
}

export async function getFulltextSchedule(resCodeList: string[]): Promise<ScheduleResult[]> {
  const ret = await resourceRequest<SchedulingResponse>('/core/fulltext/scheduling', {
    method: 'POST',
    data: { resCodeList },
  })
  return ret?.data || []
}