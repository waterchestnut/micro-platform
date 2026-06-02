import React, {createRef, useRef} from 'react'
import {type ActionType, PageContainer, ProColumns} from '@ant-design/pro-components'
import ProTableWrapper from '@/components/ProTableWrapper'
import {disableRagInfo, enableRagInfo, getRagInfoList,deleteRagInfo} from '@/services/rag/ragInfo'
import Edit, {EditAction} from './components/Edit'
import {Button, Popconfirm, Tag} from 'antd'
import {errorMessage, successMessage} from '@/utils/msg'
import {history, useModel} from '@umijs/max'

const memberTypeLabels: Record<string, string> = {
  owner: '创建者',
  admin: '管理员',
  user: '用户',
}

export type RagInfoListProps = {
  apiRelativeUrls?: any;
  toDetail?: (ragCode: string) => void;
  addHideRagCode?: boolean;
  canSetPermission?: boolean;
  checkOwnerForDangerActions?: boolean;
  showMemberRoleColumn?: boolean;
};

const RagInfoList: React.FC<RagInfoListProps> = (props) => {
  const {apiRelativeUrls, toDetail, addHideRagCode, canSetPermission = true, checkOwnerForDangerActions = false, showMemberRoleColumn = false} = props
  const actionRef = useRef<ActionType>()
  const editRef = createRef<EditAction>()
  const {initialState} = useModel('@@initialState')
  const currentUser = initialState?.currentUser

  const getMyMemberType = (record: any) => {
    return record.members?.find((m: any) => m.userCode === currentUser?.userCode)?.memberType
  }

  const isOwnerOf = (record: any) => {
    if (!checkOwnerForDangerActions) return true
    return getMyMemberType(record) === 'owner'
  }

  const canEditOf = (record: any) => {
    if (!checkOwnerForDangerActions) return true
    let mt = getMyMemberType(record)
    return mt === 'owner' || mt === 'admin'
  }

  const localEditFinish = async () => {
    actionRef.current?.reloadAndRest?.()
  }

  const columns: ProColumns[] = [
    {
      title: '知识库标识',
      dataIndex: 'ragCode',
    },
    {
      title: '知识库标题',
      dataIndex: 'title',
    },
    ...(showMemberRoleColumn ? [{
      title: '我的角色',
      dataIndex: 'memberType',
      search: false,
      render: (_: any, record: any) => {
        let mt = getMyMemberType(record)
        if (!mt) return '-'
        return <Tag color={mt === 'owner' ? 'gold' : mt === 'admin' ? 'blue' : 'default'}>
          {memberTypeLabels[mt] || mt}
        </Tag>
      },
    } as ProColumns] : []),
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
        canEditOf(record) ? <a
          key='edit'
          onClick={() => {
            editRef?.current?.show({...record})
          }}
        >
          编辑
        </a> : null,
        <a
          key='conf'
          onClick={() => {
            if (toDetail) {
              toDetail(record.ragCode)
            } else {
              history.push(`/rag/detail/${record.ragCode}`)
            }
          }}
        >
          配置
        </a>,
        isOwnerOf(record) ? <Popconfirm
          title='确定要删除该知识库吗？'
          onConfirm={async () => {
            let ret = await deleteRagInfo(record.ragCode, apiRelativeUrls?.deleteRagInfo)
            if (ret.code !== 0) {
              let msg = ret.msg || '删除失败，请稍后再试'
              return errorMessage(msg)
            }
            successMessage('删除知识库成功')
            actionRef?.current?.reloadAndRest?.()
          }}
          okText='确定'
          cancelText='取消'
          key='delete'
        >
          <a href='#'>删除</a>
        </Popconfirm> : null,
        isOwnerOf(record) && record.status === 0 ? <Popconfirm
          title='确定要禁用该知识库吗？'
          onConfirm={async () => {
            let ret = await disableRagInfo(record.ragCode, apiRelativeUrls?.disableRagInfo)
            if (ret.code !== 0) {
              let msg = ret.msg || '禁用失败，请稍后再试'
              return errorMessage(msg)
            }
            successMessage('禁用知识库成功')
            actionRef?.current?.reloadAndRest?.()
          }}
          okText='确定'
          cancelText='取消'
          key='disable'
        >
          <a href='#'>禁用</a>
        </Popconfirm> : null,
        isOwnerOf(record) && record.status === 1 ? <a
          key='enable'
          onClick={async () => {
            let ret = await enableRagInfo(record.ragCode, apiRelativeUrls?.enableRagInfo)
            if (ret.code !== 0) {
              let msg = ret.msg || '启用失败，请稍后再试'
              return errorMessage(msg)
            }
            successMessage('启用知识库成功')
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
        rowKey='ragCode'
        actionRef={actionRef}
        request={async (paramsIn, sorter, filterIn) => {
          /*console.log(paramsIn, sorter, filterIn);*/
          let filter = {...paramsIn}
          delete filter.current
          delete filter.pageSize

          let data = await getRagInfoList(paramsIn.current, paramsIn.pageSize, filter, {}, apiRelativeUrls?.getRagInfoList)
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
            添加知识库
          </Button>,
        ]}
      />
      <Edit ref={editRef} onEditFinish={localEditFinish} apiRelativeUrls={apiRelativeUrls} addHideRagCode={addHideRagCode} canSetPermission={canSetPermission}/>
    </PageContainer>
  )
}

export default RagInfoList
