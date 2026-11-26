import React, {useRef, useState} from 'react'
import {type ActionType, PageContainer, ProColumns} from '@ant-design/pro-components'
import ProTableWrapper from '@/components/ProTableWrapper'
import {getRagInfoList} from '@/services/rag/ragInfo'
import {quitMember} from '@/services/rag/ragMember'
import {history} from '@@/core/history'
import {useModel} from '@umijs/max'
import {Button, Empty, Input, Modal, Pagination, Popconfirm, Segmented, Space, Spin, Tag, Tooltip, Typography, theme} from 'antd'
import {
  AppstoreOutlined,
  BarsOutlined,
  LogoutOutlined,
  RightOutlined,
  SearchOutlined,
  SettingOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import {errorMessage, successMessage} from '@/utils/msg'
import {formatTime, MemberTypeTag, PermissionTag, StatusTag} from '@/pages/Rag/ragMeta'

const JoinedRagInfoList: React.FC = () => {
  const actionRef = useRef<ActionType>()
  const {initialState} = useModel('@@initialState')
  const currentUser = initialState?.currentUser
  const {token} = theme.useToken()

  const [viewMode, setViewMode] = useState<string>(() => {
    try {
      return localStorage.getItem('rag-joined-view-mode') || 'card'
    } catch (e) {
      return 'card'
    }
  })
  const [keyword, setKeyword] = useState('')
  const [card, setCard] = useState<any>({rows: [], total: 0, loading: true, pageIndex: 1, pageSize: 12})

  const getMemberInfo = (record: any) => {
    let member = record.members?.find((m: any) => m.userCode === currentUser?.userCode)
    let pendingApp = record.applications?.find((a: any) => a.userCode === currentUser?.userCode && a.status === 0)
    return {member, pendingApp}
  }

  const loadCards = async (pageIndex = 1, pageSize = 12, kw = keyword) => {
    setCard((s: any) => ({...s, loading: true, pageIndex}))
    let filter: any = {}
    if (kw.trim()) filter.title = kw.trim()
    try {
      let data = await getRagInfoList(pageIndex, pageSize, filter, {sort: {updateTime: -1}}, '/core/rag-my/joined-list')
      setCard({rows: data.rows || [], total: data.total || 0, loading: false, pageIndex, pageSize})
    } catch (e) {
      setCard((s: any) => ({...s, loading: false}))
    }
  }

  React.useEffect(() => {
    if (viewMode === 'card') loadCards(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode])

  const doQuit = (record: any) => {
    Modal.confirm({
      title: '确定退出该知识库？',
      content: '退出后将无法访问该知识库，但可以通过邀请链接重新加入。',
      okText: '确定退出',
      cancelText: '取消',
      onOk: async () => {
        let ret = await quitMember(record.ragCode)
        if (ret.code !== 0) {
          return errorMessage(ret.msg || '退出失败')
        }
        successMessage('已退出知识库')
        if (viewMode === 'card') {
          await loadCards(card.pageIndex, card.pageSize)
        } else {
          actionRef.current?.reloadAndRest?.()
        }
      },
    })
  }

  const toView = (record: any) => history.push(`/my-rag-joined/detail/${record.ragCode}?view=1`)
  const toConf = (record: any) => history.push(`/my-rag-joined/detail/${record.ragCode}`)

  const columns: ProColumns[] = [
    {
      title: '知识库标识',
      dataIndex: 'ragCode',
    },
    {
      title: '知识库标题',
      dataIndex: 'title',
      render: (_, record) => (
        <Space direction='vertical' size={0}>
          <a onClick={() => toView(record)}>{record.title}</a>
          {record.description ? <Typography.Text type='secondary' style={{fontSize: 12, maxWidth: 360}} ellipsis={{tooltip: record.description}}>{record.description}</Typography.Text> : null}
        </Space>
      ),
    },
    {
      title: '创建者',
      dataIndex: ['operator', 'realName'],
      search: false,
      render: (_, record) => record.operator?.realName || record.operator?.userCode || '-',
    },
    {
      title: '我的角色',
      dataIndex: 'memberType',
      search: false,
      render: (_, record) => {
        let {member, pendingApp} = getMemberInfo(record)
        if (member) return <MemberTypeTag memberType={member.memberType}/>
        if (pendingApp) return <MemberTypeTag memberType='pending'/>
        return '-'
      },
    },
    {
      title: '知识库状态',
      dataIndex: 'status',
      valueEnum: {
        '-1': {text: '已删除', status: 'Error'},
        '0': {text: '正常使用', status: 'Success'},
        '1': {text: '已禁用', status: 'Default'},
      },
      render: (_, record) => <StatusTag status={record.status}/>,
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
        if (!member) return null
        let actions: React.ReactNode[] = [
          <a key='view' onClick={() => toView(record)}>查看</a>,
        ]
        if (member.memberType === 'admin' || member.memberType === 'owner') {
          actions.push(<a key='conf' onClick={() => toConf(record)}>配置</a>)
        }
        if (member.memberType !== 'owner') {
          actions.push(<a key='quit' style={{color: '#ff4d4f'}} onClick={() => doQuit(record)}>退出</a>)
        }
        return actions
      },
    },
  ]

  const toolbar = (
    <Space wrap style={{marginBottom: 16}}>
      <Input
        allowClear
        prefix={<SearchOutlined style={{color: token.colorTextQuaternary}}/>}
        placeholder='搜索知识库标题'
        style={{width: 240}}
        value={keyword}
        onChange={e => {
          setKeyword(e.target.value)
          if (!e.target.value) loadCards(1, card.pageSize, '')
        }}
        onPressEnter={() => (viewMode === 'card' ? loadCards(1) : actionRef.current?.reloadAndRest?.())}
      />
      <Segmented
        value={viewMode}
        onChange={v => {
          const mode = v as string
          setViewMode(mode)
          try {
            localStorage.setItem('rag-joined-view-mode', mode)
          } catch (e) {
          }
        }}
        options={[
          {value: 'card', icon: <AppstoreOutlined/>},
          {value: 'table', icon: <BarsOutlined/>},
        ]}
      />
    </Space>
  )

  const renderCard = (record: any) => {
    let {member, pendingApp} = getMemberInfo(record)
    return (
      <div
        key={record.ragCode}
        onClick={() => toView(record)}
        style={{
          borderRadius: 12, border: `1px solid ${token.colorBorderSecondary}`, background: token.colorBgContainer,
          padding: 16, display: 'flex', flexDirection: 'column', gap: 10, cursor: 'pointer', height: '100%',
          transition: 'all 0.2s',
        }}
        onMouseEnter={e => {
          const el = e.currentTarget as HTMLDivElement
          el.style.borderColor = token.colorPrimaryBorder
          el.style.boxShadow = '0 4px 16px rgba(0,0,0,0.08)'
          el.style.transform = 'translateY(-2px)'
        }}
        onMouseLeave={e => {
          const el = e.currentTarget as HTMLDivElement
          el.style.borderColor = token.colorBorderSecondary
          el.style.boxShadow = 'none'
          el.style.transform = 'none'
        }}
      >
        <div style={{display: 'flex', alignItems: 'center', gap: 8, minWidth: 0}}>
          <Typography.Text strong style={{fontSize: 15, flex: 1, minWidth: 0}} ellipsis={{tooltip: record.title}}>{record.title}</Typography.Text>
          <StatusTag status={record.status}/>
        </div>
        <Typography.Paragraph type='secondary' style={{fontSize: 13, marginBottom: 0, minHeight: 42}} ellipsis={{rows: 2, tooltip: record.description}}>
          {record.description || '暂无描述'}
        </Typography.Paragraph>
        <div style={{display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center'}}>
          {member ? <MemberTypeTag memberType={member.memberType}/> : pendingApp ? <MemberTypeTag memberType='pending'/> : null}
          <PermissionTag permission={record.permission}/>
          <Tooltip title='成员数'>
            <span style={{fontSize: 12, color: token.colorTextSecondary}}><TeamOutlined/> {record.members?.length ?? 0}</span>
          </Tooltip>
        </div>
        <div style={{marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: token.colorTextQuaternary, fontSize: 12}}>
          <span>
            {record.operator?.realName || record.operator?.userCode || '-'} · {formatTime(record.updateTime)}
          </span>
          <Space size={4} onClick={e => e.stopPropagation()}>
            {(member?.memberType === 'admin' || member?.memberType === 'owner') ? <Tooltip title='配置管理'>
              <Button size='small' type='text' icon={<SettingOutlined/>} onClick={() => toConf(record)}/>
            </Tooltip> : null}
            {member && member.memberType !== 'owner' ? <Tooltip title='退出知识库'>
              <Button size='small' type='text' danger icon={<LogoutOutlined/>} onClick={() => doQuit(record)}/>
            </Tooltip> : null}
            <RightOutlined style={{fontSize: 10, marginInlineStart: 4}}/>
          </Space>
        </div>
      </div>
    )
  }

  return (
    <PageContainer>
      {viewMode === 'card' ? <>
        {toolbar}
        <Spin spinning={card.loading}>
          {card.rows.length ? <>
            <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16}}>
              {card.rows.map(renderCard)}
            </div>
            <div style={{display: 'flex', justifyContent: 'flex-end', marginTop: 16}}>
              <Pagination
                current={card.pageIndex}
                pageSize={card.pageSize}
                total={card.total}
                showSizeChanger={false}
                showTotal={t => `共 ${t} 个知识库`}
                onChange={p => loadCards(p, card.pageSize)}
              />
            </div>
          </> : <Empty style={{padding: '60px 0'}} description={keyword ? '没有匹配的知识库' : '还没有加入任何知识库，可在知识库广场浏览并申请加入'}/>}
        </Spin>
      </> : <>
        {toolbar}
        <ProTableWrapper
          columns={columns}
          rowKey='ragCode'
          actionRef={actionRef}
          search={false}
          options={false}
          request={async (paramsIn) => {
            let filter: any = {}
            if (keyword.trim()) filter.title = keyword.trim()
            let data = await getRagInfoList(paramsIn.current, paramsIn.pageSize, filter, {sort: {updateTime: -1}}, '/core/rag-my/joined-list')
            return {
              data: data.rows,
              total: data.total,
              success: true
            }
          }}
        />
      </>}
    </PageContainer>
  )
}

export default JoinedRagInfoList
