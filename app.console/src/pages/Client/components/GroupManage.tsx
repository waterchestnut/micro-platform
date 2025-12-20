import React, {createRef, useRef} from 'react'
import {ActionType, ProColumns} from '@ant-design/pro-components'
import GroupPrivs, {GroupPrivsAction} from '@/pages/Client/components/GroupPrivs'
import ProTableWrapper from '@/components/ProTableWrapper'
import {getGroupPrivsList} from '@/services/app/clientPriv'

export type GroupManageProps = {
  pClientInfo?: any;
  apiRelativeUrls?: any;
};

const GroupManage: React.FC<GroupManageProps> = (props) => {
  const {pClientInfo, apiRelativeUrls} = props
  const actionRef = useRef<ActionType>()
  const privsRef = createRef<GroupPrivsAction>()

  const localEditFinish = async () => {
    actionRef.current?.reloadAndRest?.()
  }
  const columns: ProColumns[] = [
    {
      title: '角色标识',
      dataIndex: 'groupCode',
    },
    {
      title: '角色名称',
      dataIndex: 'groupName',
    },
    {
      title: '备注',
      dataIndex: 'description',
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
          key='privs'
          onClick={() => {
            privsRef?.current?.show({...record})
          }}
        >
          权限分配
        </a>
      ],
    },
  ]
  return (
    <>
      <ProTableWrapper
        columns={columns}
        headerTitle='按角色分组赋权'
        rowKey='groupCode'
        actionRef={actionRef}
        search={false}
        pagination={{hideOnSinglePage: true, pageSize: 2000}}
        request={async (paramsIn, sorter, filterIn) => {
          /*console.log(paramsIn, sorter, filterIn);*/
          let data = await getGroupPrivsList(pClientInfo.clientCode, apiRelativeUrls?.getGroupPrivsList)
          return {
            data: data,
            total: data?.length || 0,
            success: true
          }
        }}
      />
      <GroupPrivs ref={privsRef} onSaveFinish={localEditFinish} clientCode={pClientInfo.clientCode}
                  apiRelativeUrls={apiRelativeUrls}/>
    </>
  )
}

export default GroupManage
