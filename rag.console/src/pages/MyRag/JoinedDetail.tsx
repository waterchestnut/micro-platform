import React, {useEffect, useState} from 'react'
import RagInfoDetail from '@/pages/Rag/Detail'
import {history} from '@@/core/history'
import {getRagInfo} from '@/services/rag/ragInfo'
import {quitMember} from '@/services/rag/ragMember'
import {useModel, useParams, useSearchParams} from '@umijs/max'
import {Button, Popconfirm, Spin} from 'antd'
import {errorMessage, successMessage} from '@/utils/msg'

const JoinedRagInfoDetail: React.FC = () => {
  const {initialState} = useModel('@@initialState')
  const currentUser = initialState?.currentUser
  const params = useParams()
  const [searchParams] = useSearchParams()
  const isViewMode = searchParams.get('view') === '1'
  const [memberRole, setMemberRole] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!params.ragCode || !currentUser?.userCode) return
    getRagInfo(params.ragCode, '/core/rag-my/detail').then(info => {
      if (!info?.ragCode) {
        setMemberRole('pending')
        setLoading(false)
        return
      }
      let member = info.members?.find((m: any) => m.userCode === currentUser.userCode)
      if (member) {
        setMemberRole(member.memberType)
      } else {
        let hasPending = info.applications?.some((a: any) => a.userCode === currentUser.userCode && a.status === 0)
        setMemberRole(hasPending ? 'pending' : 'user')
      }
      setLoading(false)
    }).catch(() => {
      setMemberRole('pending')
      setLoading(false)
    })
  }, [params.ragCode, currentUser?.userCode])

  if (loading) {
    return <div style={{textAlign: 'center', padding: 100}}><Spin size='large'/></div>
  }

  let effectiveRole = isViewMode ? 'user' : memberRole
  let canEdit = effectiveRole === 'owner' || effectiveRole === 'admin'
  let canDelete = effectiveRole === 'owner'
  let canManageMembers = effectiveRole === 'owner' || effectiveRole === 'admin'

  let apiRelativeUrls: any = {
    getRagInfo: '/core/rag-my/detail',
    getRagMaterialList: '/core/rag-my/material/list',
    getRagMaterial: '/core/rag-my/material/detail',
    getRagSegmentList: '/core/rag-my/segment/list',
    getRagSegment: '/core/rag-my/segment/detail',
    getRagChunkList: '/core/rag-my/chunk/list',
    getRagChunk: '/core/rag-my/chunk/detail',
    getOperationLogList: '/core/rag-my/log/list',
  }

  if (canEdit) {
    apiRelativeUrls.updateRagInfo = '/core/rag-my/update'
    apiRelativeUrls.addRagMaterial = '/core/rag-my/material/add'
    apiRelativeUrls.updateRagMaterial = '/core/rag-my/material/update'
    apiRelativeUrls.deleteRagMaterial = '/core/rag-my/material/delete'
    apiRelativeUrls.enableRagMaterial = '/core/rag-my/material/enable'
    apiRelativeUrls.disableRagMaterial = '/core/rag-my/material/disable'
    apiRelativeUrls.addRagSegment = '/core/rag-my/segment/add'
    apiRelativeUrls.updateRagSegment = '/core/rag-my/segment/update'
    apiRelativeUrls.deleteRagSegment = '/core/rag-my/segment/delete'
    apiRelativeUrls.enableRagSegment = '/core/rag-my/segment/enable'
    apiRelativeUrls.disableRagSegment = '/core/rag-my/segment/disable'
    apiRelativeUrls.addRagChunk = '/core/rag-my/chunk/add'
    apiRelativeUrls.updateRagChunk = '/core/rag-my/chunk/update'
    apiRelativeUrls.deleteRagChunk = '/core/rag-my/chunk/delete'
    apiRelativeUrls.enableRagChunk = '/core/rag-my/chunk/enable'
    apiRelativeUrls.disableRagChunk = '/core/rag-my/chunk/disable'
  }

  if (canDelete) {
    apiRelativeUrls.deleteRagInfo = '/core/rag-my/delete'
    apiRelativeUrls.enableRagInfo = '/core/rag-my/enable'
    apiRelativeUrls.disableRagInfo = '/core/rag-my/disable'
  }

  if (canManageMembers) {
    apiRelativeUrls.removeMember = '/core/rag-my/member/remove'
    apiRelativeUrls.updateMemberType = '/core/rag-my/member/update-type'
    apiRelativeUrls.handleApplication = '/core/rag-my/application/handle'
  }

  let headerExtra: React.ReactNode = null
  if (memberRole && memberRole !== 'owner' && memberRole !== 'pending') {
    headerExtra = (
      <Popconfirm
        title='确定退出该知识库？'
        description='退出后将无法访问该知识库，但可以通过邀请链接重新加入。'
        onConfirm={async () => {
          let ret = await quitMember(params.ragCode!)
          if (ret.code !== 0) {
            return errorMessage(ret.msg || '退出失败')
          }
          successMessage('已退出知识库')
          history.push('/my-rag-joined/list')
        }}
        okText='确定退出'
        cancelText='取消'
      >
        <Button danger>退出知识库</Button>
      </Popconfirm>
    )
  }

  return (
    <RagInfoDetail
      apiRelativeUrls={apiRelativeUrls}
      memberRole={effectiveRole}
      canSetPermission={false}
      canManageMembers={canManageMembers}
      headerExtra={headerExtra}
      toBack={() => {
        history.push('/my-rag-joined/list')
      }}
      toMaterialDetail={(ragCode: string, ragMaterialCode: string) => {
        history.push(`/my-rag-joined/detail/${ragCode}/${ragMaterialCode}${isViewMode ? '?view=1' : ''}`)
      }}
    />
  )
}

export default JoinedRagInfoDetail
