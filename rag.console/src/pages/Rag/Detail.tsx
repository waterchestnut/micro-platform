import React, {createRef, useEffect, useState} from 'react'
import {PageContainer, ProCard} from '@ant-design/pro-components'
import BaseInfo, {BaseInfoAction} from '@/pages/Rag/components/BaseInfo'
import {useParams, history} from '@umijs/max'
import {getRagInfo} from '@/services/rag/ragInfo'
import MaterialManage from '@/pages/Rag/components/MaterialManage'
import RagSearch from '@/pages/Rag/components/RagSearch'

export type RagInfoDetailProps = {
  apiRelativeUrls?: any;
  toBack?: (ragCode: string) => void;
  toMaterialDetail?: (ragCode: string, ragMaterialCode: string) => void;
};

const RagInfoDetail: React.FC<RagInfoDetailProps> = (props) => {
  const {apiRelativeUrls, toBack, toMaterialDetail} = props
  const [activeKey, setActiveKey] = useState('material')
  const [ragInfo, setRagInfo] = useState<any>(null)
  const baseInfoRef = createRef<BaseInfoAction>()
  const [loading, setLoading] = useState<any>(true)
  const params = useParams()

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
            pRagInfo={ragInfo}
            apiRelativeUrls={apiRelativeUrls}
          />
        </ProCard>
      )
    }
    if (activeKey === 'material') {
      return (
        <MaterialManage pRagInfo={ragInfo} apiRelativeUrls={apiRelativeUrls} toDetail={toMaterialDetail}/>
      )
    }
    if (activeKey === 'rag-search') {
      return (
        <RagSearch pRagInfo={ragInfo} apiRelativeUrls={apiRelativeUrls}/>
      )
    }
    if (activeKey === 'member') {
      return (
        <div>成员管理</div>
      )
    }
    return null
  }

  return (
    <PageContainer
      loading={loading}
      tabList={[
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
        {
          tab: '成员管理',
          key: 'member',
        },
      ]}
      header={{
        title: ragInfo?.title,
        onBack: () => {
          if (toBack) {
            toBack(params.ragCode + '')
          } else {
            history.push('/rag/list')
          }
        }
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
