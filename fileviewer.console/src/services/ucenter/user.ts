import { ucenterRequest } from '@/services/request'
import { getEmbeddedProps, isEmbedded } from '@/utils/embed'

export interface UserInfo {
  userCode: string
  loginName?: string
  realName?: string
  nickName?: string
  avatarUrl?: string
  mobile?: string
  email?: string
  accessToken?: string
  expiresTime?: number
  refreshToken?: string
}

export async function queryCurrentUser(): Promise<{
  code: number
  data?: UserInfo
}> {
  if (isEmbedded()) {
    return {
      code: 0,
      data: (getEmbeddedProps() as any)?.getUserCache?.(),
    }
  }
  return ucenterRequest<UserInfo>('/core/user/cur', { method: 'GET' })
}
