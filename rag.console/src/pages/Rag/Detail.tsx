import React, {createRef, useEffect, useState} from 'react'
import {PageContainer, ProCard} from '@ant-design/pro-components'
import BaseInfo, {BaseInfoAction} from '@/pages/Rag/components/BaseInfo'
import {useParams, history} from '@umijs/max'
import {getRagInfo} from '@/services/rag/ragInfo'
import {getRagMaterialList} from '@/services/rag/ragMaterial'
import {getRagSegmentList} from '@/services/rag/ragSegment'
import {getRagChunkList} from '@/services/rag/ragChunk'
import MaterialManage from '@/pages/Rag/components/MaterialManage'
import RagSearch from '@/pages/Rag/components/RagSearch'
import MemberManage from '@/pages/Rag/components/MemberManage'
import OperationLog from '@/pages/Rag/components/OperationLog'
import {Space, Statistic, Tag, Tooltip, Typography, theme} from 'antd'
import {CodeTag, formatTime, PermissionTag, StatusTag} from './ragMeta'

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
  const [stats, setStats] = useState<any>(null)
  const baseInfoRef = createRef<BaseInfoAction>()
  const [loading, setLoading] = useState<any>(true)
  const params = useParams()
  const {token} = theme.useToken()

  let isReadonly = memberRole === 'user' || memberRole === 'pending'
  let canEditMaterial = !isReadonly && (memberRole === undefined || memberRole === 'owner' || memberRole === 'admin')
  let showMemberTab = memberRole !== 'pending'

  const loadStats = async (ragCode: string) => {
    try {
      const [m, s, c] = await Promise.all([
        getRagMaterialList(1, 1, {ragCode}, {}, apiRelativeUrls?.getRagMaterialList, ragCode),
        getRagSegmentList(1, 1, {ragCode}, {}, apiRelativeUrls?.getRagSegmentList, ragCode),
        getRagChunkList(1, 1, {ragCode}, {}, apiRelativeUrls?.getRagChunkList, ragCode),
      ])
      setStats({material: m.total || 0, segment: s.total || 0, chunk: c.total || 0})
    } catch (e) {
      setStats(null)
    }
  }

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
    loadStats(info.ragCode)
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
        <RagSearch pRagInfo={ragInfo} apiRelativeUrls={apiRelativeUrls} toMaterialDetail={toMaterialDetail}/>
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

  const statItems = [
    {title: '材料', value: stats?.material},
    {title: '分段', value: stats?.segment},
    {title: '向量分句', value: stats?.chunk},
    {title: '成员', value: ragInfo ? (ragInfo.members?.length ?? 0) : undefined},
  ]

  return (
    <PageContainer
      loading={loading}
      tabList={tabList}
      header={{
        title: (
          <Space size={8} wrap>
            <span>{ragInfo?.title}</span>
            {ragInfo ? <StatusTag status={ragInfo.status}/> : null}
            {ragInfo?.ragType === 'builtIn' ? <Tag color='gold' bordered={false}>内置</Tag> : null}
          </Space>
        ),
        onBack: () => {
          if (toBack) {
            toBack(params.ragCode + '')
          } else {
            history.push(`${location.pathname.startsWith('/lite/') ? '/lite' : ''}/rag/list`)
          }
        },
        extra: headerExtra,
      }}
      content={ragInfo ? (
        <div style={{display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'center'}}>
          <div style={{display: 'flex', gap: 28, flexWrap: 'wrap'}}>
            {statItems.map(s => (
              <Statistic key={s.title} title={s.title} value={s.value ?? '-'} valueStyle={{fontSize: 20, color: token.colorText}}/>
            ))}
          </div>
          <div style={{flex: 1, minWidth: 260, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start'}}>
            <Typography.Paragraph type='secondary' style={{fontSize: 13, marginBottom: 0}} ellipsis={{rows: 2, tooltip: ragInfo.description}}>
              {ragInfo.description || '暂无描述'}
            </Typography.Paragraph>
            <Space size={6} wrap>
              <PermissionTag permission={ragInfo.permission}/>
              <CodeTag text={ragInfo.embeddingModelId} title={`${ragInfo.embeddingModelProvider || ''} ${ragInfo.embeddingModelId || ''}`.trim()}/>
              <Tooltip title='创建者 · 最近更新'>
                <span style={{fontSize: 12, color: token.colorTextQuaternary}}>
                  {ragInfo.operator?.realName || ragInfo.operator?.userCode || '-'} · {formatTime(ragInfo.updateTime)}
                </span>
              </Tooltip>
            </Space>
          </div>
        </div>
      ) : null}
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
