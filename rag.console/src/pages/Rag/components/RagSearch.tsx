import React, {createRef, useRef, useState} from 'react'
import {ActionType, ProCard, ProColumns, ProList} from '@ant-design/pro-components'
import {history} from '@@/core/history'
import {Button, Popconfirm, Space, Switch, Typography} from 'antd'
import {vecSearch} from '@/services/rag/ragSearch'

export type RagSearchProps = {
  pRagInfo?: any;
  apiRelativeUrls?: any;
};

const RagSearch: React.FC<RagSearchProps> = (props) => {
  const {pRagInfo, apiRelativeUrls} = props
  const [totalSegCount, setTotalSegCount] = useState<any>(0)
  const actionRef = useRef<ActionType>()
  return (
    <>
      <ProList<any>
        actionRef={actionRef}
        headerTitle={`召回${totalSegCount}个分段`}
        itemLayout='vertical'
        rowKey='ragSegmentCode'
        request={async (paramsIn, sorter, filterIn) => {
          /*console.log(paramsIn, sorter, filterIn);*/
          if (!paramsIn.keyword) {
            return {
              data: [],
              total: 0,
              success: true
            }
          }

          let data = await vecSearch(paramsIn.keyword, {
            withChunks: 1,
            ragCode: pRagInfo.ragCode,
            maxLength: paramsIn.maxLength || 6
          })
          setTotalSegCount(data.length)
          return {
            data: data,
            total: data.length,
            success: true
          }
        }}
        pagination={{pageSize: totalSegCount || 100}}
        search={{}}
        metas={{
          title: {
            title: '源文本',
            key: 'keyword',
            valueType: 'textarea',
            render: (dom, record) => (
              <Space>
                <span>S-{record.position}</span><span>{record.wordCount}字符</span><span>{record.tokens}tokens</span><span>语言：{record.language}</span>
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
            search: false,
            render: (dom, record) => (
              <ProCard
                ghost
                collapsible
                title={<Space>命中分句（子片段）</Space>}
                defaultCollapsed={false}
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
                        <Space>
                          <span>C-{chunkRecord.position}</span>
                          <span>{chunkRecord.wordCount}字符</span>
                          <span>语言：{chunkRecord.language}</span>
                          <span>得分：{chunkRecord.score}</span>
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
    </>
  )
}

export default RagSearch
