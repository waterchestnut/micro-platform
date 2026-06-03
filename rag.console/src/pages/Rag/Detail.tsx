import React, {createRef, useEffect, useState} from 'react'
import {PageContainer, ProCard} from '@ant-design/pro-components'
import BaseInfo, {BaseInfoAction} from '@/pages/Rag/components/BaseInfo'
import {useParams, history} from '@umijs/max'
import {getRagInfo} from '@/services/rag/ragInfo'
import MaterialManage from '@/pages/Rag/components/MaterialManage'
import RagSearch from '@/pages/Rag/components/RagSearch'
import MemberManage from '@/pages/Rag/components/MemberManage'
import OperationLog from '@/pages/Rag/components/OperationLog'

export type RagInfoDetailProps = {
  apiRelativeUrls?: any;
  toBack?: (ragCode: string) => void;
  toMaterialDetail?: (ragCode: string, ragMaterialCode: string) => void;
  canSetPermission?: boolean;
  canManageMembers?: boolean;
  memberRole?: string;
  headerExtra?: React.ReactNode;
};

const RagInfoDetail: React.FC<RagInfoDetailProps> = (props) => {
  const {apiRelativeUrls, toBack, toMaterialDetail, canSetPermission = true, canManageMembers = true, memberRole, headerExtra} = props
  const [activeKey, setActiveKey] = useState('material')
  const [ragInfo, setRagInfo] = useState<any>(null)
  const baseInfoRef = createRef<BaseInfoAction>()
  const [loading, setLoading] = useState<any>(true)
  const params = useParams()

  let isReadonly = memberRole === 'user' || memberRole === 'pending'
  let canEditMaterial = !isReadonly && (memberRole === undefined || memberRole === 'owner' || memberRole === 'admin')
  let showMemberTab = memberRole !== 'pending'

  const loadRagInfo = async () => {
    if (!params.ragCode) {
      return history.push('/404')
    }
    setLoading(true)
    let info = await getRagInfo(params.ragCode, apiRelativeUrls?.getRagInfo)
    if (!info?.ragCode) {
      return history.push('/404')
    }
    setRagInfo(info)
    setLoading(false)
  }

  useEffect(() => {
    if (!params.ragCode) {
      return history.push('/404')
    }
    loadRagInfo()
  }, [params.ragCode])

  const renderContent = () => {
    if (activeKey === 'base') {
      return (
        <ProCard>
          <BaseInfo
            ref={baseInfoRef}
            onEditFinish={async () => {
              loadRagInfo()
            }}
            onEditCancel={() => {
            }}
            pRagInfo={isReadonly ? {...ragInfo, viewer: true} : ragInfo}
            apiRelativeUrls={apiRelativeUrls}
            canSetPermission={canSetPermission}
          />
        </ProCard>
      )
    }
    if (activeKey === 'material') {
      return (
        <MaterialManage pRagInfo={ragInfo} apiRelativeUrls={apiRelativeUrls} toDetail={toMaterialDetail} canEdit={canEditMaterial}/>
      )
    }
    if (activeKey === 'rag-search') {
      return (
        <RagSearch pRagInfo={ragInfo} apiRelativeUrls={apiRelativeUrls}/>
      )
    }
    if (activeKey === 'member') {
      return (
        <MemberManage pRagInfo={ragInfo} apiRelativeUrls={apiRelativeUrls} canManageMembers={canManageMembers}/>
      )
    }
    if (activeKey === 'log') {
      return (
        <OperationLog pRagInfo={ragInfo} apiRelativeUrls={apiRelativeUrls}/>
      )
    }
    return null
  }

  let tabList = [
    {
      tab: '基本信息',
      key: 'base',
    },
    {
      tab: '材料',
      key: 'material',
    },
    {
      tab: '召回测试',
      key: 'rag-search',
    },
  ]

  if (showMemberTab) {
    tabList.push({
      tab: '成员管理',
      key: 'member',
    })
  }

  tabList.push({
    tab: '操作日志',
    key: 'log',
  })

  return (
    <PageContainer
      loading={loading}
      tabList={tabList}
      header={{
        title: ragInfo?.title,
        onBack: () => {
          if (toBack) {
            toBack(params.ragCode + '')
          } else {
            history.push(`${location.pathname.startsWith('/lite/') ? '/lite' : ''}/rag/list`)
          }
        },
        extra: headerExtra,
      }}
      tabActiveKey={activeKey}
      onTabChange={(activeKey) => {
        setActiveKey(activeKey)
      }}
      className='tab-page-container'
    >
      {renderContent()}
    </PageContainer>
  )
}

export default RagInfoDetail
