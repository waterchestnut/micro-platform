import React, {createRef, useEffect, useRef, useState} from 'react'
import {type ActionType, PageContainer, ProCard, ProList} from '@ant-design/pro-components'
import {useParams, history} from '@umijs/max'
import {getRagInfo} from '@/services/rag/ragInfo'
import {getRagMaterial} from '@/services/rag/ragMaterial'
import {Button, Descriptions, Popconfirm, Space, Switch, Tag, Tooltip, Typography} from 'antd'
import {
  DeleteOutlined,
  EditOutlined,
  LinkOutlined,
} from '@ant-design/icons'
import SegmentEdit, {SegmentEditAction} from '@/pages/Rag/components/SegmentEdit'
import ChunkEdit, {ChunkEditAction} from '@/pages/Rag/components/ChunkEdit'
import {errorMessage, successMessage} from '@/utils/msg'
import {deleteRagChunk, disableRagChunk, enableRagChunk} from '@/services/rag/ragChunk'
import {deleteRagSegment, disableRagSegment, enableRagSegment, getRagSegmentList, updateRagSegment} from '@/services/rag/ragSegment'
import {formatTime, HandleStatusTag} from './ragMeta'

export type RagMaterialDetailProps = {
  apiRelativeUrls?: any;
  toBack?: (ragCode: string) => void;
};

const RagMaterialDetail: React.FC<RagMaterialDetailProps> = (props) => {
  const {apiRelativeUrls, toBack} = props
  const [ragInfo, setRagInfo] = useState<any>(null)
  const [ragMaterialInfo, setRagMaterialInfo] = useState<any>(null)
  const [loading, setLoading] = useState<any>(true)
  const [totalSegCount, setTotalSegCount] = useState<any>(0)
  const params = useParams()
  const actionRef = useRef<ActionType>()

  const segmentEditRef = createRef<SegmentEditAction>()
  const chunkEditRef = createRef<ChunkEditAction>()

  const localEditFinish = async () => {
    actionRef.current?.reload?.()
  }

  const loadRagMaterialInfo = async () => {
    if (!params.ragCode || !params.ragMaterialCode) {
      return history.push('/404')
    }
    setLoading(true)
    let info = await getRagInfo(params.ragCode, apiRelativeUrls?.getRagInfo)
    if (!info?.ragCode) {
      return history.push('/404')
    }
    setRagInfo(info)
    let materialInfo = await getRagMaterial(params.ragMaterialCode, apiRelativeUrls?.getRagMaterial, params.ragCode)
    if (!materialInfo?.ragCode) {
      return history.push('/404')
    }
    setRagMaterialInfo(materialInfo)
    setLoading(false)
  }

  useEffect(() => {
    if (!params.ragCode || !params.ragMaterialCode) {
      return history.push('/404')
    }
    loadRagMaterialInfo()
  }, [params.ragCode, params.ragMaterialCode])

  const onDeleteSegment = async (segmentRecord: any) => {
    let ret = await deleteRagSegment(segmentRecord.ragSegmentCode, apiRelativeUrls?.deleteRagSegment, ragMaterialInfo.ragCode)
    if (ret.code !== 0) {
      let msg = ret.msg || '删除失败，请稍后再试'
      return errorMessage(msg)
    }
    successMessage('删除成功')
    await localEditFinish()
  }

  const onDeleteChunk = async (chunkRecord: any) => {
    let ret = await deleteRagChunk(chunkRecord.ragChunkCode, apiRelativeUrls?.deleteRagChunk, ragMaterialInfo.ragCode)
    if (ret.code !== 0) {
      let msg = ret.msg || '删除失败，请稍后再试'
      return errorMessage(msg)
    }
    successMessage('删除成功')
    await localEditFinish()
  }

  const onToggleSegment = async (segmentRecord: any, checked: boolean) => {
    let ret = checked ? (await enableRagSegment(segmentRecord.ragSegmentCode, apiRelativeUrls?.enableRagSegment, ragMaterialInfo.ragCode)) : (await disableRagSegment(segmentRecord.ragSegmentCode, apiRelativeUrls?.disableRagSegment, ragMaterialInfo.ragCode))
    let tip = checked ? '启用分段' : '禁用分段'
    if (ret.code !== 0) {
      let msg = ret.msg || tip + '失败，请稍后再试'
      return errorMessage(msg)
    }
    successMessage(tip + '成功')
    await localEditFinish()
  }

  const onToggleChunk = async (chunkRecord: any, checked: boolean) => {
    let ret = checked ? (await enableRagChunk(chunkRecord.ragChunkCode, apiRelativeUrls?.enableRagChunk, ragMaterialInfo.ragCode)) : (await disableRagChunk(chunkRecord.ragChunkCode, apiRelativeUrls?.disableRagChunk, ragMaterialInfo.ragCode))
    let tip = checked ? '启用分句' : '禁用分句'
    if (ret.code !== 0) {
      let msg = ret.msg || tip + '失败，请稍后再试'
      return errorMessage(msg)
    }
    successMessage(tip + '成功')
    await localEditFinish()
  }

  return (
    <PageContainer
      loading={loading}
      header={{
        breadcrumb: {},
        title: ragMaterialInfo?.resTitle || '材料片段',
        onBack: () => {
          if (toBack) {
            toBack(params.ragCode + '')
          } else {
            history.push(`${location.pathname.startsWith('/lite/') ? '/lite' : ''}/rag/detail/${ragInfo.ragCode}`)
          }
        }
      }}
      content={ragMaterialInfo ? (
        <Descriptions size='small' column={{xs: 1, sm: 2, md: 3}} style={{marginBottom: 0}}>
          <Descriptions.Item label='所属知识库'>{ragInfo?.title}</Descriptions.Item>
          <Descriptions.Item label='材料标识'>
            <Typography.Text copyable={{text: ragMaterialInfo.ragMaterialCode}} style={{fontSize: 12, color: 'rgba(0,0,0,0.45)'}} ellipsis>
              {ragMaterialInfo.ragMaterialCode}
            </Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label='格式'>
            {ragMaterialInfo.format ? <Tag bordered={false} style={{fontFamily: 'monospace'}}>{String(ragMaterialInfo.format).toLowerCase()}</Tag> : '-'}
          </Descriptions.Item>
          <Descriptions.Item label='处理状态'>
            <HandleStatusTag handleStatus={ragMaterialInfo.handleStatus} handleError={ragMaterialInfo.handleError}/>
          </Descriptions.Item>
          <Descriptions.Item label='原文链接'>
            {ragMaterialInfo.resOriginalUrl
              ? <a href={ragMaterialInfo.resOriginalUrl} target='_blank' rel='noreferrer'>查看原文 <LinkOutlined style={{fontSize: 11}}/></a>
              : '-'}
          </Descriptions.Item>
          <Descriptions.Item label='更新时间'>{formatTime(ragMaterialInfo.updateTime)}</Descriptions.Item>
          {ragMaterialInfo.description ? <Descriptions.Item label='备注' span={3}>{ragMaterialInfo.description}</Descriptions.Item> : null}
        </Descriptions>
      ) : null}
    >
      <ProList<any>
        actionRef={actionRef}
        headerTitle={<Space>共 <Typography.Text strong>{totalSegCount}</Typography.Text> 个分段</Space>}
        itemLayout='vertical'
        rowKey='ragSegmentCode'
        request={async (paramsIn, sorter, filterIn) => {
          /*console.log(paramsIn, sorter, filterIn);*/
          let filter = {...paramsIn, ragMaterialCode: params.ragMaterialCode}
          delete filter.current
          delete filter.pageSize

          let data = await getRagSegmentList(paramsIn.current, paramsIn.pageSize, filter, {withChunk: 1}, apiRelativeUrls?.getRagSegmentList, params.ragCode || '')
          setTotalSegCount(data.total)
          return {
            data: data.rows,
            total: data.total,
            success: true
          }
        }}
        pagination={{pageSize: 10, showTotal: t => `共 ${t} 条`}}
        toolBarRender={() => {
          return [
            <Button
              key='add' type='primary'
              onClick={() => {
                segmentEditRef?.current?.show()
              }}
            >
              添加片段
            </Button>,
          ]
        }}
        search={{}}
        metas={{
          title: {
            title: '片段关键词',
            key: 'keyword',
            render: (dom, record) => (
              <div style={{display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap'}}>
                <Tag bordered={false} color={record.status === 0 ? 'geekblue' : 'default'} style={{fontFamily: 'monospace'}}>S-{record.position}</Tag>
                {record.status !== 0 ? <Tag color='orange' bordered={false}>已禁用</Tag> : null}
                <span style={{fontSize: 12, color: 'rgba(0,0,0,0.45)'}}>
                  {record.wordCount ?? 0}字符 · {record.tokens ?? 0}tokens
                  {record.chunks?.length ? ` · ${record.chunks.length}个分句` : ''}
                  {record.language && record.language !== 'zh' ? ` · 语言：${record.language}` : ''}
                </span>
                <Space size={0} style={{marginInlineStart: 'auto'}}>
                  <Tooltip title='编辑分段'>
                    <Button
                      type='text' size='small' icon={<EditOutlined/>}
                      onClick={(e) => {
                        segmentEditRef?.current?.show(record)
                      }}
                    />
                  </Tooltip>
                  <Popconfirm
                    title='确定要删除该分段吗？'
                    onConfirm={async () => {
                      await onDeleteSegment(record)
                    }}
                    okText='确定'
                    cancelText='取消'
                  >
                    <Tooltip title='删除分段'>
                      <Button type='text' size='small' danger icon={<DeleteOutlined/>}/>
                    </Tooltip>
                  </Popconfirm>
                  <Switch
                    size='small'
                    checkedChildren='启' unCheckedChildren='禁'
                    checked={record.status === 0}
                    onChange={(checked) => {
                      onToggleSegment(record, checked)
                    }}
                  />
                </Space>
              </div>
            ),
          },
          description: {
            render: (dom, record) => (
              <Typography.Paragraph
                style={{fontSize: 13, lineHeight: 1.7, marginBottom: 4}}
                ellipsis={{
                  rows: 3,
                  expandable: 'collapsible',
                }}
                copyable
              >
                {record.content}
              </Typography.Paragraph>
            ),
            search: false
          },
          content: {
            title: '片段语言',
            key: 'language',
            render: (dom, record) => (
              <ProCard
                ghost
                collapsible
                title={<Space size={6}>分句（子片段）<Button type='link' size='small' onClick={(e) => {
                  chunkEditRef?.current?.show(null, record)
                  e.stopPropagation()
                }}>添加</Button></Space>}
                defaultCollapsed={true}
                headerBordered
                style={{marginTop: '-32px', marginBottom: '-12px'}}
              >
                <ProList<any>
                  itemLayout='vertical'
                  rowKey='ragChunkCode'
                  pagination={false}
                  dataSource={record.chunks || []}
                  metas={{
                    title: {
                      render: (dom, chunkRecord) => (
                        <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
                          <span style={{fontFamily: 'monospace', fontSize: 12, color: 'rgba(0,0,0,0.45)'}}>C-{chunkRecord.position}</span>
                          {chunkRecord.status !== 0 ? <Tag color='orange' bordered={false} style={{fontSize: 11}}>已禁用</Tag> : null}
                          <span style={{fontSize: 12, color: 'rgba(0,0,0,0.45)'}}>{chunkRecord.wordCount ?? 0}字符</span>
                          <Space size={0} style={{marginInlineStart: 'auto'}}>
                            <Button
                              type='text' size='small' icon={<EditOutlined/>}
                              onClick={(e) => {
                                chunkEditRef?.current?.show(chunkRecord, record)
                              }}
                            />
                            <Popconfirm
                              title='确定要删除该分句吗？'
                              onConfirm={async () => {
                                await onDeleteChunk(chunkRecord)
                              }}
                              okText='确定'
                              cancelText='取消'
                            >
                              <Button type='text' size='small' danger icon={<DeleteOutlined/>}/>
                            </Popconfirm>
                            <Switch
                              size='small'
                              checkedChildren='启' unCheckedChildren='禁'
                              checked={chunkRecord.status === 0}
                              onChange={(checked) => {
                                onToggleChunk(chunkRecord, checked)
                              }}
                            />
                          </Space>
                        </div>
                      ),
                    },
                    description: {
                      render: (dom, chunkRecord) => (
                        <Typography.Paragraph
                          style={{fontSize: 12, marginBottom: 0}}
                          ellipsis={{
                            rows: 1,
                            expandable: 'collapsible',
                          }}
                          copyable
                        >
                          {chunkRecord.content}
                        </Typography.Paragraph>
                      ),
                    },
                  }}
                />
              </ProCard>
            ),
          },
        }}
      />
      <SegmentEdit ref={segmentEditRef} apiRelativeUrls={apiRelativeUrls} pMaterialInfo={ragMaterialInfo}
                   onEditFinish={async () => {
                     await localEditFinish()
                   }}/>
      <ChunkEdit ref={chunkEditRef} apiRelativeUrls={apiRelativeUrls} pMaterialInfo={ragMaterialInfo}
                 onEditFinish={async () => {
                   await localEditFinish()
                 }}/>
    </PageContainer>
  )
}

export default RagMaterialDetail
