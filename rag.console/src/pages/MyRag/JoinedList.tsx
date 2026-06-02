import React, {useRef} from 'react'
import {type ActionType, PageContainer, ProColumns} from '@ant-design/pro-components'
import ProTableWrapper from '@/components/ProTableWrapper'
import {getRagInfoList} from '@/services/rag/ragInfo'
import {quitMember} from '@/services/rag/ragMember'
import {history} from '@@/core/history'
import {useModel} from '@umijs/max'
import {Popconfirm, Tag} from 'antd'
import {errorMessage, successMessage} from '@/utils/msg'

const memberTypeLabels: Record<string, string> = {
  owner: '创建者',
  admin: '管理员',
  user: '用户',
}

const JoinedRagInfoList: React.FC = () => {
  const actionRef = useRef<ActionType>()
  const {initialState} = useModel('@@initialState')
  const currentUser = initialState?.currentUser

  const getMemberInfo = (record: any) => {
    let member = record.members?.find((m: any) => m.userCode === currentUser?.userCode)
    let pendingApp = record.applications?.find((a: any) => a.userCode === currentUser?.userCode && a.status === 0)
    return {member, pendingApp}
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
    {
      title: '创建者',
      dataIndex: ['operator', 'realName'],
      search: false,
    },
    {
      title: '我的角色',
      dataIndex: 'memberType',
      search: false,
      render: (_, record) => {
        let {member, pendingApp} = getMemberInfo(record)
        if (member) {
          return <Tag color={member.memberType === 'owner' ? 'gold' : member.memberType === 'admin' ? 'blue' : 'default'}>
            {memberTypeLabels[member.memberType] || member.memberType}
          </Tag>
        }
        if (pendingApp) {
          return <Tag color='orange'>待审批</Tag>
        }
        return '-'
      },
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
      width: 160,
      fixed: 'right',
      className: 'option-wrap',
      render: (_, record) => {
        let {member} = getMemberInfo(record)
        if (!member) {
          return null
        }
        let actions: React.ReactNode[] = [
          <a
            key='view'
            onClick={() => {
              history.push(`/my-rag-joined/detail/${record.ragCode}?view=1`)
            }}
          >
            查看
          </a>,
        ]
        if (member.memberType === 'admin' || member.memberType === 'owner') {
          actions.push(
            <a
              key='conf'
              onClick={() => {
                history.push(`/my-rag-joined/detail/${record.ragCode}`)
              }}
            >
              配置
            </a>,
          )
        }
        if (member.memberType !== 'owner') {
          actions.push(
            <Popconfirm
              key='quit'
              title='确定退出该知识库？'
              description='退出后将无法访问该知识库，但可以通过邀请链接重新加入。'
              onConfirm={async () => {
                let ret = await quitMember(record.ragCode)
                if (ret.code !== 0) {
                  return errorMessage(ret.msg || '退出失败')
                }
                successMessage('已退出知识库')
                actionRef.current?.reloadAndRest?.()
              }}
              okText='确定退出'
              cancelText='取消'
            >
              <a>退出</a>
            </Popconfirm>,
          )
        }
        return actions
      },
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
