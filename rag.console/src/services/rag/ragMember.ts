import {ragRequest} from '@/services/request'

export async function addMember(ragCode: string, userCode: string, realName: string, memberType = 'user', relativeUrl = '') {
  return ragRequest(relativeUrl || '/core/rag-my/member/add', {
    method: 'POST',
    data: {ragCode, userCode, realName, memberType}
  })
}

export async function removeMember(ragCode: string, userCode: string, relativeUrl = '') {
  return ragRequest(relativeUrl || '/core/rag-my/member/remove', {
    method: 'POST',
    data: {ragCode, userCode}
  })
}

export async function updateMemberType(ragCode: string, userCode: string, memberType: string, relativeUrl = '') {
  return ragRequest(relativeUrl || '/core/rag-my/member/update-type', {
    method: 'POST',
    data: {ragCode, userCode, memberType}
  })
}

export async function applyJoin(ragCode: string, relativeUrl = '') {
  return ragRequest(relativeUrl || '/core/rag-my/application/apply', {
    method: 'POST',
    data: {ragCode}
  })
}

export async function handleApplication(ragCode: string, applicationCode: string, status: number, relativeUrl = '') {
  return ragRequest(relativeUrl || '/core/rag-my/application/handle', {
    method: 'POST',
    data: {ragCode, applicationCode, status}
  })
}
