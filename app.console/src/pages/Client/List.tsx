import React, {createRef, useRef} from 'react'
import {type ActionType, PageContainer, ProColumns} from '@ant-design/pro-components'
import ProTableWrapper from '@/components/ProTableWrapper'
import {disableClient, enableClient, getClientList} from '@/services/app/client'
import Edit, {EditAction} from './components/Edit'
import {Button, Popconfirm} from 'antd'
import {deleteClient} from '@/services/app/client'
import {errorMessage, successMessage} from '@/utils/msg'
import EndpointTypeEnum from '@/enum/EndpointTypeEnum'
import {history} from '@umijs/max'

export type ClientListProps = {
  apiRelativeUrls?: any;
  toDetail?: (clientCode: string) => void;
};

const ClientList: React.FC<ClientListProps> = (props) => {
  const {apiRelativeUrls, toDetail} = props
  const actionRef = useRef<ActionType>()
  const editRef = createRef<EditAction>()

  const localEditFinish = async () => {
    actionRef.current?.reloadAndRest?.()
  }

  const columns: ProColumns[] = [
    {
      title: '应用标识',
      dataIndex: 'clientCode',
    },
    {
      title: '应用名称',
      dataIndex: 'clientName',
    },
    {
      title: '访问端',
      dataIndex: 'endpoints',
      key: 'endpointType',
      valueEnum: EndpointTypeEnum.toValueEnum(),
      render: (text, record) => {
        if (record.endpoints?.length > 0) {
          return record.endpoints.map((_: any) => EndpointTypeEnum.toLabel(_.endpointType)).join('\r\n')
        }
        return '-'
      }
    },
    {
      title: '应用状态',
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
      title: '排序(值越小展示越靠前)',
      dataIndex: 'order',
    },
    {
      title: '操作',
      dataIndex: 'option',
      valueType: 'option',
      width: 240,
      fixed: 'right',
      className: 'option-wrap',
      render: (_, record) => [
        <a
          key='view'
          onClick={() => {
            editRef?.current?.show({...record, viewer: true})
          }}
        >
          查看
        </a>,
        <a
          key='edit'
          onClick={() => {
            editRef?.current?.show({...record})
          }}
        >
          编辑
        </a>,
        <a
          key='conf'
          onClick={() => {
            if (toDetail) {
              toDetail(record.clientCode)
            } else {
              history.push(`/client/detail/${record.clientCode}`)
            }
          }}
        >
          配置
        </a>,
        <Popconfirm
          title='确定要删除该应用吗？'
          onConfirm={async () => {
            let ret = await deleteClient(record.clientCode, apiRelativeUrls?.deleteClient)
            if (ret.code !== 0) {
              let msg = ret.msg || '删除失败，请稍后再试'
              return errorMessage(msg)
            }
            successMessage('删除应用成功')
            actionRef?.current?.reloadAndRest?.()
          }}
          okText='确定'
          cancelText='取消'
          key='delete'
        >
          <a href='#'>删除</a>
        </Popconfirm>,
        record.status === 0 ? <Popconfirm
          title='确定要禁用该应用吗？'
          onConfirm={async () => {
            let ret = await disableClient(record.clientCode, apiRelativeUrls?.disableClient)
            if (ret.code !== 0) {
              let msg = ret.msg || '禁用失败，请稍后再试'
              return errorMessage(msg)
            }
            successMessage('禁用应用成功')
            actionRef?.current?.reloadAndRest?.()
          }}
          okText='确定'
          cancelText='取消'
          key='disable'
        >
          <a href='#'>禁用</a>
        </Popconfirm> : null,
        record.status === 1 ? <a
          key='enable'
          onClick={async () => {
            let ret = await enableClient(record.clientCode, apiRelativeUrls?.enableClient)
            if (ret.code !== 0) {
              let msg = ret.msg || '启用失败，请稍后再试'
              return errorMessage(msg)
            }
            successMessage('启用应用成功')
            actionRef?.current?.reloadAndRest?.()
          }}
        >
          启用
        </a> : null,
      ],
    },
  ]

  return (
    <PageContainer>
      <ProTableWrapper
        columns={columns}
        rowKey='clientCode'
        actionRef={actionRef}
        request={async (paramsIn, sorter, filterIn) => {
          /*console.log(paramsIn, sorter, filterIn);*/
          let filter = {...paramsIn}
          delete filter.current
          delete filter.pageSize

          let data = await getClientList(paramsIn.current, paramsIn.pageSize, filter, {}, apiRelativeUrls?.getClientList)
          return {
            data: data.rows,
            total: data.total,
            success: true
          }
        }}
        toolBarRender={() => [
          <Button type='primary' key='add' onClick={() => {
            editRef?.current?.show()
          }}>
            添加应用
          </Button>,
        ]}
      />
      <Edit ref={editRef} onEditFinish={localEditFinish} apiRelativeUrls={apiRelativeUrls}/>
    </PageContainer>
  )
}

export default ClientList
