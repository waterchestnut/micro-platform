import React, {createRef, useRef} from 'react'
import {ActionType, ProColumns} from '@ant-design/pro-components'
import {EditAction} from '@/pages/Client/components/WidgetEdit'
import {Button, Popconfirm, Tag} from 'antd'
import {errorMessage, successMessage} from '@/utils/msg'
import {deleteWidget, enableWidget, disableWidget, getWidgetList} from '@/services/app/widget'
import ProTableWrapper from '@/components/ProTableWrapper'
import Edit from '@/pages/Client/components/WidgetEdit'
import {getDocHttpUrl} from '@/utils/util'

export type WidgetManageProps = {
  pClientInfo?: any;
  apiRelativeUrls?: any;
};

const WidgetManage: React.FC<WidgetManageProps> = (props) => {
  const {pClientInfo, apiRelativeUrls} = props
  const actionRef = useRef<ActionType>()
  const editRef = createRef<EditAction>()

  const localEditFinish = async () => {
    actionRef.current?.reloadAndRest?.()
  }

  const handleEnable = async (widgetCode: string) => {
    let ret = await enableWidget(widgetCode, apiRelativeUrls?.enableWidget)
    if (ret.code !== 0) {
      let msg = ret.msg || '启用失败，请稍后再试'
      return errorMessage(msg)
    }
    successMessage('启用成功')
    actionRef?.current?.reloadAndRest?.()
  }

  const handleDisable = async (widgetCode: string) => {
    let ret = await disableWidget(widgetCode, apiRelativeUrls?.disableWidget)
    if (ret.code !== 0) {
      let msg = ret.msg || '禁用失败，请稍后再试'
      return errorMessage(msg)
    }
    successMessage('禁用成功')
    actionRef?.current?.reloadAndRest?.()
  }

  const columns: ProColumns[] = [
    {
      title: '小组件标识',
      dataIndex: 'widgetCode',
    },
    {
      title: '小组件名称',
      dataIndex: 'widgetName',
    },
    {
      title: '小组件图标',
      dataIndex: 'logoUrl',
      render: (val) => {
        if (!val) return '-'
        return <img src={getDocHttpUrl(val as string)} alt='logo'
                    style={{width: 32, height: 32, objectFit: 'contain'}}/>
      },
    },
    {
      title: '排序',
      dataIndex: 'order',
      width: 80,
    },
    {
      title: 'PC端跳转地址',
      dataIndex: 'pcRedirectUrl',
      width: 160,
      render: (val) => val || '-',
      ellipsis: true,
    },
    {
      title: '小程序端跳转地址',
      dataIndex: 'miniRedirectUrl',
      width: 160,
      render: (val) => val || '-',
      ellipsis: true,
    },
    {
      title: '默认首页',
      dataIndex: 'default2Home',
      render: (val) => {
        return val ? <Tag color='success'>是</Tag> : <Tag>否</Tag>
      },
      width: 100,
    },
    {
      title: '状态',
      dataIndex: 'status',
      render: (val) => {
        return val === 0 ? <Tag color='success'>已启用</Tag> : <Tag color='default'>已禁用</Tag>
      },
    },
    {
      title: '操作',
      dataIndex: 'option',
      valueType: 'option',
      width: 200,
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
            editRef?.current?.show(record)
          }}
        >
          修改
        </a>,
        record.status === 0 ? <Popconfirm
          title='确定要禁用该小组件吗？'
          onConfirm={async () => {
            await handleDisable(record.widgetCode)
          }}
          okText='确定'
          cancelText='取消'
          key='disable'
        >
          <a href='#'>禁用</a>
        </Popconfirm> : <a
          key='enable'
          onClick={async () => {
            await handleEnable(record.widgetCode)
          }}
        >
          启用
        </a>,
        <Popconfirm
          title='确定要删除该小组件吗？'
          onConfirm={async () => {
            let ret = await deleteWidget(record.widgetCode, apiRelativeUrls?.deleteWidget)
            if (ret.code !== 0) {
              let msg = ret.msg || '删除失败，请稍后再试'
              return errorMessage(msg)
            }
            successMessage('删除小组件成功')
            actionRef?.current?.reloadAndRest?.()
          }}
          okText='确定'
          cancelText='取消'
          key='delete'
        >
          <a href='#'>删除</a>
        </Popconfirm>
      ],
    },
  ]
  return (
    <>
      <ProTableWrapper
        columns={columns}
        rowKey='widgetCode'
        actionRef={actionRef}
        search={false}
        pagination={{hideOnSinglePage: true, pageSize: 2000}}
        request={async (paramsIn, sorter, filterIn) => {
          let filter = {
            clientCode: pClientInfo.clientCode,
            ...filterIn
          }
          let data = await getWidgetList(1, 2000, filter, {}, apiRelativeUrls?.getWidgetList)
          return {
            data: data?.rows || [],
            total: data?.total || 0,
            success: true
          }
        }}
        toolBarRender={() => [
          <Button type='primary' key='add' onClick={() => {
            editRef?.current?.show()
          }}>
            添加小组件
          </Button>,
        ]}
      />
      <Edit ref={editRef} onEditFinish={localEditFinish} pClientInfo={pClientInfo} apiRelativeUrls={apiRelativeUrls}/>
    </>
  )
}

export default WidgetManage
