import React, {useRef} from 'react'
import {type ActionType, PageContainer, ProColumns} from '@ant-design/pro-components'
import ProTableWrapper from '@/components/ProTableWrapper'
import {getRagInfoList} from '@/services/rag/ragInfo'
import {history} from '@@/core/history'

const JoinedRagInfoList: React.FC = () => {
  const actionRef = useRef<ActionType>()

  const columns: ProColumns[] = [
    {
      title: '知识库标识',
      dataIndex: 'ragCode',
    },
    {
      title: '知识库标题',
      dataIndex: 'title',
    },
    {
      title: '创建者',
      dataIndex: ['operator', 'realName'],
      search: false,
    },
    {
      title: '知识库状态',
      dataIndex: 'status',
      valueEnum: {
        '-1': {
          text: '已删除',
          status: 'Error',
        },
        '0': {
          text: '正常使用',
          status: 'Success',
        },
        '1': {
          text: '已禁用',
          status: 'Default',
        }
      },
    },
    {
      title: '操作',
      dataIndex: 'option',
      valueType: 'option',
      width: 100,
      fixed: 'right',
      className: 'option-wrap',
      render: (_, record) => [
        <a
          key='view'
          onClick={() => {
            history.push(`/my-rag-joined/detail/${record.ragCode}`)
          }}
        >
          查看
        </a>,
      ],
    },
  ]

  return (
    <PageContainer>
      <ProTableWrapper
        columns={columns}
        rowKey='ragCode'
        actionRef={actionRef}
        request={async (paramsIn) => {
          let filter = {...paramsIn}
          delete filter.current
          delete filter.pageSize

          let data = await getRagInfoList(paramsIn.current, paramsIn.pageSize, filter, {}, '/core/rag-my/joined-list')
          return {
            data: data.rows,
            total: data.total,
            success: true
          }
        }}
      />
    </PageContainer>
  )
}

export default JoinedRagInfoList
