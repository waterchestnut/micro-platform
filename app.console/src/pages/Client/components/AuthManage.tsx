import React, {createRef, useRef} from 'react'
import {ActionType, ProColumns} from '@ant-design/pro-components'
import {EditAction} from '@/pages/Client/components/AuthEdit'
import {Button, Popconfirm} from 'antd'
import {errorMessage, successMessage} from '@/utils/msg'
import {deleteClientPriv, getClientPrivList} from '@/services/app/clientPriv'
import ProTableWrapper from '@/components/ProTableWrapper'
import Edit from '@/pages/Client/components/AuthEdit'

export type AuthManageProps = {
  pClientInfo?: any;
  apiRelativeUrls?: any;
};

const AuthManage: React.FC<AuthManageProps> = (props) => {
  const {pClientInfo, apiRelativeUrls} = props
  const actionRef = useRef<ActionType>()
  const editRef = createRef<EditAction>()

  const localEditFinish = async () => {
    actionRef.current?.reloadAndRest?.()
  }

  const columns: ProColumns[] = [
    {
      title: '权限标识',
      dataIndex: 'modulePrivCode',
    },
    {
      title: '权限名称',
      dataIndex: 'modulePrivName',
    },
    {
      title: '所属模块',
      dataIndex: 'moduleName',
    },
    {
      title: '操作',
      dataIndex: 'option',
      valueType: 'option',
      width: 160,
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
        record.modulePrivCode !== `${pClientInfo.clientCode}-browse` ? <Popconfirm
          title='确定要删除该权限吗？'
          onConfirm={async () => {
            let ret = await deleteClientPriv(pClientInfo.clientCode, record.modulePrivCode, apiRelativeUrls?.deleteClientPriv)
            if (ret.code !== 0) {
              let msg = ret.msg || '删除失败，请稍后再试'
              return errorMessage(msg)
            }
            successMessage('删除权限成功')
            actionRef?.current?.reloadAndRest?.()
          }}
          okText='确定'
          cancelText='取消'
          key='delete'
        >
          <a href='#'>删除</a>
        </Popconfirm> : null,
      ],
    },
  ]
  return (
    <>
      <ProTableWrapper
        columns={columns}
        rowKey='modulePrivCode'
        actionRef={actionRef}
        search={false}
        pagination={{hideOnSinglePage: true, pageSize: 2000}}
        request={async (paramsIn, sorter, filterIn) => {
          /*console.log(paramsIn, sorter, filterIn);*/

          let data = await getClientPrivList(pClientInfo.clientCode, apiRelativeUrls?.getClientPrivList)
          return {
            data: data,
            total: data?.length || 0,
            success: true
          }
        }}
        toolBarRender={() => [
          <Button type='primary' key='add' onClick={() => {
            editRef?.current?.show()
          }}>
            添加权限
          </Button>,
        ]}
      />
      <Edit ref={editRef} onEditFinish={localEditFinish} clientCode={pClientInfo.clientCode}
            apiRelativeUrls={apiRelativeUrls}/>
    </>
  )
}

export default AuthManage
