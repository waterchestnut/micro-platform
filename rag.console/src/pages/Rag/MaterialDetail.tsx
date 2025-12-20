import React, {createRef, useEffect, useRef, useState} from 'react'
import {type ActionType, PageContainer, ProCard, ProList} from '@ant-design/pro-components'
import {useParams, history} from '@umijs/max'
import {getRagInfo} from '@/services/rag/ragInfo'
import {getRagMaterial} from '@/services/rag/ragMaterial'
import {Button, Descriptions, Popconfirm, Space, Switch, Typography} from 'antd'
import {
  deleteRagSegment,
  disableRagSegment,
  enableRagSegment,
  getRagSegmentList,
  updateRagSegment
} from '@/services/rag/ragSegment'
import {DeleteOutlined, EditOutlined} from '@ant-design/icons'
import SegmentEdit, {SegmentEditAction} from '@/pages/Rag/components/SegmentEdit'
import ChunkEdit, {ChunkEditAction} from '@/pages/Rag/components/ChunkEdit'
import {errorMessage, successMessage} from '@/utils/msg'
import {deleteRagChunk, disableRagChunk, enableRagChunk} from '@/services/rag/ragChunk'

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
        title: `《${ragInfo?.title}》的材料片段`,
        onBack: () => {
          if (toBack) {
            toBack(params.ragCode + '')
          } else {
            history.push(`/rag/detail/${ragInfo.ragCode}`)
          }
        }
      }}
      content={
        <Descriptions column={2}>
          <Descriptions.Item label='材料标识'>{ragMaterialInfo?.ragMaterialCode}</Descriptions.Item>
          <Descriptions.Item label='材料标题'>
            {ragMaterialInfo?.resTitle}
          </Descriptions.Item>
        </Descriptions>
      }
    >
      <ProList<any>
        actionRef={actionRef}
        headerTitle={`${totalSegCount}个分段`}
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
        pagination={{pageSize: 10}}
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
              <Space><span>S-{record.position}</span><span>{record.wordCount}字符</span><span>{record.tokens}tokens</span><span>语言：{record.language}</span>
                <Button
                  type='text'
                  onClick={(e) => {
                    segmentEditRef?.current?.show(record)
                  }}
                ><EditOutlined/></Button>
                <Popconfirm
                  title='确定要删除该分段吗？'
                  onConfirm={async () => {
                    await onDeleteSegment(record)
                  }}
                  okText='确定'
                  cancelText='取消'
                >
                  <Button
                    type='text'
                  ><DeleteOutlined/></Button>
                </Popconfirm>
                <Switch
                  checkedChildren='已启用' unCheckedChildren='已禁用'
                  checked={!record.status}
                  onChange={(checked) => {
                    onToggleSegment(record, checked)
                  }}
                />
              </Space>
            ),
          },
          description: {
            render: (dom, record) => (
              <Typography.Paragraph
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
                title={<Space>分句（子片段）<Button type='link' onClick={(e) => {
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
                        <Space><span>C-{chunkRecord.position}</span><span>{chunkRecord.wordCount}字符</span><span>语言：{chunkRecord.language}</span>
                          <Button
                            type='text'
                            onClick={(e) => {
                              chunkEditRef?.current?.show(chunkRecord, record)
                            }}
                          ><EditOutlined/></Button>
                          <Popconfirm
                            title='确定要删除该分句吗？'
                            onConfirm={async () => {
                              await onDeleteChunk(chunkRecord)
                            }}
                            okText='确定'
                            cancelText='取消'
                          >
                            <Button type='text'><DeleteOutlined/></Button>
                          </Popconfirm>
                          <Switch
                            checkedChildren='已启用' unCheckedChildren='已禁用'
                            checked={!chunkRecord.status}
                            onChange={(checked) => {
                              onToggleChunk(chunkRecord, checked)
                            }}
                          />
                        </Space>
                      ),
                    },
                    description: {
                      render: (dom, chunkRecord) => (
                        <Typography.Paragraph
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

