import React, {createRef, useRef} from 'react'
import {ActionType, ProColumns} from '@ant-design/pro-components'
import {EditAction} from '@/pages/Client/components/ModuleEdit'
import {Button, Popconfirm} from 'antd'
import {errorMessage, successMessage} from '@/utils/msg'
import {deleteClientModule, getClientModuleList} from '@/services/app/clientModule'
import ProTableWrapper from '@/components/ProTableWrapper'
import Edit from '@/pages/Client/components/ModuleEdit'

export type ModuleManageProps = {
  pClientInfo?: any;
  apiRelativeUrls?: any;
};

const ModuleManage: React.FC<ModuleManageProps> = (props) => {
  const {pClientInfo, apiRelativeUrls} = props
  const actionRef = useRef<ActionType>()
  const editRef = createRef<EditAction>()

  const localEditFinish = async () => {
    actionRef.current?.reloadAndRest?.()
  }

  const columns: ProColumns[] = [
    {
      title: '模块标识',
      dataIndex: 'moduleCode',
    },
    {
      title: '模块名称',
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
        record.moduleCode !== `${pClientInfo.clientCode}-main` ? <Popconfirm
          title='确定要删除该模块吗？'
          onConfirm={async () => {
            let ret = await deleteClientModule(pClientInfo.clientCode, record.moduleCode, apiRelativeUrls?.deleteClientModule)
            if (ret.code !== 0) {
              let msg = ret.msg || '删除失败，请稍后再试'
              return errorMessage(msg)
            }
            successMessage('删除模块成功')
            actionRef?.current?.reloadAndRest?.()
          }}
          okText='确定'
          cancelText='取消'
          key='delete'
        >
          <a href='#'>删除</a>
        </Popconfirm> : null
      ],
    },
  ]
  return (
    <>
      <ProTableWrapper
        columns={columns}
        rowKey='moduleCode'
        actionRef={actionRef}
        search={false}
        pagination={{hideOnSinglePage: true, pageSize: 2000}}
        request={async (paramsIn, sorter, filterIn) => {
          /*console.log(paramsIn, sorter, filterIn);*/

          let data = await getClientModuleList(pClientInfo.clientCode, apiRelativeUrls?.getClientModuleList)
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
            添加模块
          </Button>,
        ]}
      />
      <Edit ref={editRef} onEditFinish={localEditFinish} clientCode={pClientInfo.clientCode}
            apiRelativeUrls={apiRelativeUrls}/>
    </>
  )
}

export default ModuleManage
