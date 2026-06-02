import React, {useEffect, useState} from 'react'
import {ProCard, ProList} from '@ant-design/pro-components'
import {Avatar, Badge, Button, Popconfirm, Select, Space, Tabs, Tag} from 'antd'
import {handleApplication, removeMember, updateMemberType} from '@/services/rag/ragMember'
import {errorMessage, successMessage} from '@/utils/msg'
import {UserOutlined} from '@ant-design/icons'

export type MemberManageProps = {
  pRagInfo?: any;
  apiRelativeUrls?: any;
  canManageMembers?: boolean;
};

const memberTypeOptions = [
  {label: '管理员', value: 'admin'},
  {label: '用户', value: 'user'},
]

const memberTypeLabels: Record<string, string> = {
  owner: '创建者',
  admin: '管理员',
  user: '用户',
}

const memberTypeColors: Record<string, string> = {
  owner: 'gold',
  admin: 'blue',
  user: 'default',
}

const memberTypeDescriptions: Record<string, string> = {
  admin: '可浏览、编辑、提问知识库',
  user: '可浏览、提问知识库',
}

const MemberManage: React.FC<MemberManageProps> = (props) => {
  const {pRagInfo, apiRelativeUrls, canManageMembers} = props
  const [activeTab, setActiveTab] = useState('members')
  const [members, setMembers] = useState<any[]>([])
  const [applications, setApplications] = useState<any[]>([])

  useEffect(() => {
    if (pRagInfo) {
      setMembers(pRagInfo.members || [])
      setApplications((pRagInfo.applications || []).filter((a: any) => a.status === 0))
    }
  }, [pRagInfo])

  const handleRemoveMember = async (userCode: string) => {
    let ret = await removeMember(pRagInfo.ragCode, userCode, apiRelativeUrls?.removeMember)
    if (ret.code !== 0) {
      return errorMessage(ret.msg || '移除成员失败')
    }
    successMessage('移除成员成功')
    setMembers(members.filter(m => m.userCode !== userCode))
  }

  const handleUpdateMemberType = async (userCode: string, memberType: string) => {
    let ret = await updateMemberType(pRagInfo.ragCode, userCode, memberType, apiRelativeUrls?.updateMemberType)
    if (ret.code !== 0) {
      return errorMessage(ret.msg || '更新成员角色失败')
    }
    successMessage('更新成员角色成功')
    setMembers(members.map(m => m.userCode === userCode ? {...m, memberType} : m))
  }

  const handleApprove = async (applicationCode: string) => {
    let ret = await handleApplication(pRagInfo.ragCode, applicationCode, 1, apiRelativeUrls?.handleApplication)
    if (ret.code !== 0) {
      return errorMessage(ret.msg || '操作失败')
    }
    successMessage('已同意加入申请')
    setApplications(applications.filter(a => a.applicationCode !== applicationCode))
    let app = applications.find(a => a.applicationCode === applicationCode)
    if (app) {
      setMembers([...members, {userCode: app.userCode, realName: app.realName, memberType: 'user'}])
    }
  }

  const handleReject = async (applicationCode: string) => {
    let ret = await handleApplication(pRagInfo.ragCode, applicationCode, 2, apiRelativeUrls?.handleApplication)
    if (ret.code !== 0) {
      return errorMessage(ret.msg || '操作失败')
    }
    successMessage('已拒绝加入申请')
    setApplications(applications.filter(a => a.applicationCode !== applicationCode))
  }

  const renderMembers = () => {
    return (
      <ProList
        rowKey='userCode'
        dataSource={members}
        metas={{
          avatar: {
            render: () => <Avatar icon={<UserOutlined/>} size='small'/>,
          },
          title: {
            render: (_, record) => (
              <Space>
                <span>{record.realName}</span>
                <Tag color={memberTypeColors[record.memberType]}>
                  {memberTypeLabels[record.memberType]}
                </Tag>
              </Space>
            ),
          },
          description: {
            render: (_, record) => {
              if (record.memberType === 'owner') {
                return null
              }
              return memberTypeDescriptions[record.memberType] || null
            },
          },
          actions: {
            render: (_, record) => {
              if (!canManageMembers || record.memberType === 'owner') {
                return null
              }
              return (
                <Space>
                  <Select
                    size='small'
                    value={record.memberType}
                    options={memberTypeOptions}
                    onChange={(value) => handleUpdateMemberType(record.userCode, value)}
                    style={{width: 100}}
                  />
                  <Popconfirm
                    title='确定移除成员？'
                    description='确定移除该成员？移除后不可恢复，但该成员仍可重新申请加入本库。'
                    onConfirm={() => handleRemoveMember(record.userCode)}
                    okText='确定移除'
                    cancelText='取消'
                  >
                    <a>移除</a>
                  </Popconfirm>
                </Space>
              )
            },
          },
        }}
      />
    )
  }

  const renderApplications = () => {
    if (!applications.length) {
      return <div style={{textAlign: 'center', padding: 40, color: '#999'}}>暂无待审批的申请</div>
    }
    return (
      <ProList
        rowKey='applicationCode'
        dataSource={applications}
        metas={{
          avatar: {
            render: () => <Avatar icon={<UserOutlined/>} size='small'/>,
          },
          title: {
            render: (_, record) => (
              <span>{record.realName}申请加入知识库</span>
            ),
          },
          actions: {
            render: (_, record) => (
              <Space>
                <Button type='link' size='small' onClick={() => handleApprove(record.applicationCode)}>
                  同意
                </Button>
                <Button type='link' size='small' danger onClick={() => handleReject(record.applicationCode)}>
                  拒绝
                </Button>
              </Space>
            ),
          },
        }}
      />
    )
  }

  const tabItems = [
    {
      key: 'members',
      label: (
        <span>
          成员
          {members.length > 0 && <Badge count={members.length} style={{marginLeft: 4, backgroundColor: '#1890ff'}} size='small'/>}
        </span>
      ),
      children: renderMembers(),
    },
  ]

  if (canManageMembers) {
    tabItems.push({
      key: 'applications',
      label: (
        <span>
          申请
          {applications.length > 0 && <Badge count={applications.length} style={{marginLeft: 4}} size='small'/>}
        </span>
      ),
      children: renderApplications(),
    })
  }

  return (
    <ProCard>
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={tabItems}
      />
    </ProCard>
  )
}

export default MemberManage
