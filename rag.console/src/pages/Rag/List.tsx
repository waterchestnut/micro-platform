import React, {createRef, useEffect, useRef, useState} from 'react'
import {type ActionType, PageContainer, ProColumns} from '@ant-design/pro-components'
import ProTableWrapper from '@/components/ProTableWrapper'
import {disableRagInfo, enableRagInfo, getRagInfoList, deleteRagInfo} from '@/services/rag/ragInfo'
import Edit, {EditAction} from './components/Edit'
import {Button, Dropdown, Empty, Input, Modal, Pagination, Segmented, Select, Space, Spin, Tag, Tooltip, Typography, theme} from 'antd'
import {
  AppstoreOutlined,
  BarsOutlined,
  DeleteOutlined,
  EyeOutlined,
  MoreOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  RightOutlined,
  SearchOutlined,
  SettingOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import {history, useModel} from '@umijs/max'
import {errorMessage, successMessage} from '@/utils/msg'
import {CodeTag, formatTime, MemberTypeTag, PermissionTag, StatusTag} from './ragMeta'

export type RagInfoListProps = {
  apiRelativeUrls?: any;
  toDetail?: (ragCode: string) => void;
  addHideRagCode?: boolean;
  canSetPermission?: boolean;
  checkOwnerForDangerActions?: boolean;
  showMemberRoleColumn?: boolean;
};

const VIEW_KEY = 'rag-list-view-mode'

const RagInfoList: React.FC<RagInfoListProps> = (props) => {
  const {apiRelativeUrls, toDetail, addHideRagCode, canSetPermission = true, checkOwnerForDangerActions = false, showMemberRoleColumn = false} = props
  const actionRef = useRef<ActionType>()
  const editRef = createRef<EditAction>()
  const {initialState} = useModel('@@initialState')
  const currentUser = initialState?.currentUser
  const {token} = theme.useToken()

  const [viewMode, setViewMode] = useState<string>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) || 'card'
    } catch (e) {
      return 'card'
    }
  })
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [sortKey, setSortKey] = useState('updateTime')
  const [card, setCard] = useState<any>({rows: [], total: 0, loading: true, pageIndex: 1, pageSize: 12})
  // 最新筛选条件镜像（避免 loadCards 闭包过期）
  const condRef = useRef({keyword, statusFilter, sortKey})
  condRef.current = {keyword, statusFilter, sortKey}

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

  const loadCards = async (pageIndex = 1, pageSize = 12) => {
    const cond = condRef.current
    setCard((s: any) => ({...s, loading: true, pageIndex}))
    let filter: any = {}
    if (cond.keyword.trim()) filter.title = cond.keyword.trim()
    if (cond.statusFilter !== 'all') filter.status = Number(cond.statusFilter)
    let sort: any = cond.sortKey === 'title' ? {title: 1} : {[cond.sortKey]: -1}
    try {
      let data = await getRagInfoList(pageIndex, pageSize, filter, {sort}, apiRelativeUrls?.getRagInfoList)
      setCard({rows: data.rows || [], total: data.total || 0, loading: false, pageIndex, pageSize})
    } catch (e) {
      setCard((s: any) => ({...s, loading: false}))
    }
  }

  useEffect(() => {
    if (viewMode === 'card') {
      loadCards(1)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode])

  const reload = () => {
    if (viewMode === 'card') {
      loadCards(card.pageIndex, card.pageSize)
    } else {
      actionRef.current?.reloadAndRest?.()
    }
  }

  const localEditFinish = async () => {
    reload()
  }

  const toDetailOf = (record: any) => {
    if (toDetail) {
      toDetail(record.ragCode)
    } else {
      history.push(`${location.pathname.startsWith('/lite/') ? '/lite' : ''}/rag/detail/${record.ragCode}`)
    }
  }

  const confirmDelete = (record: any) => {
    Modal.confirm({
      title: '确定要删除该知识库吗？',
      content: `知识库「${record.title}」及其材料删除后将不可恢复`,
      okText: '确定删除',
      okButtonProps: {danger: true},
      cancelText: '取消',
      onOk: async () => {
        let ret = await deleteRagInfo(record.ragCode, apiRelativeUrls?.deleteRagInfo)
        if (ret.code !== 0) {
          let msg = ret.msg || '删除失败，请稍后再试'
          return errorMessage(msg)
        }
        successMessage('删除知识库成功')
        await localEditFinish()
      },
    })
  }

  const doToggleStatus = async (record: any, enable: boolean) => {
    let ret = enable
      ? await enableRagInfo(record.ragCode, apiRelativeUrls?.enableRagInfo)
      : await disableRagInfo(record.ragCode, apiRelativeUrls?.disableRagInfo)
    let tip = enable ? '启用知识库成功' : '禁用知识库成功'
    if (ret.code !== 0) {
      let msg = ret.msg || (enable ? '启用失败，请稍后再试' : '禁用失败，请稍后再试')
      return errorMessage(msg)
    }
    successMessage(tip)
    await localEditFinish()
  }

  const cardMenuItems = (record: any) => {
    let isBuiltIn = record.ragType === 'builtIn'
    let items: any[] = []
    if (!isBuiltIn && canEditOf(record)) {
      items.push({key: 'edit', icon: <SettingOutlined/>, label: '编辑', onClick: () => editRef?.current?.show({...record})})
    }
    if (!isBuiltIn && isOwnerOf(record) && record.status === 0) {
      items.push({key: 'disable', icon: <PauseCircleOutlined/>, label: '禁用', onClick: () => doToggleStatus(record, false)})
    }
    if (!isBuiltIn && isOwnerOf(record) && record.status === 1) {
      items.push({key: 'enable', icon: <PlayCircleOutlined/>, label: '启用', onClick: () => doToggleStatus(record, true)})
    }
    if (!isBuiltIn && isOwnerOf(record)) {
      if (items.length) items.push({type: 'divider'})
      items.push({key: 'delete', icon: <DeleteOutlined/>, danger: true, label: '删除', onClick: () => confirmDelete(record)})
    }
    return items.length ? items : null
  }

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
          <a onClick={() => toDetailOf(record)}>{record.title}</a>
          {record.description ? <Typography.Text type='secondary' style={{fontSize: 12, maxWidth: 360}} ellipsis={{tooltip: record.description}}>{record.description}</Typography.Text> : null}
        </Space>
      ),
    },
    ...(showMemberRoleColumn ? [{
      title: '我的角色',
      dataIndex: 'memberType',
      search: false,
      render: (_: any, record: any) => <MemberTypeTag memberType={getMyMemberType(record)}/>,
    } as ProColumns] : []),
    {
      title: '权限',
      dataIndex: 'permission',
      search: false,
      render: (_, record) => <PermissionTag permission={record.permission}/>,
    },
    {
      title: '向量模型',
      dataIndex: 'embeddingModelId',
      search: false,
      render: (_, record) => <CodeTag text={record.embeddingModelId} title={`${record.embeddingModelProvider || ''} ${record.embeddingModelId || ''}`.trim()}/>,
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
      render: (_, record) => <StatusTag status={record.status}/>,
    },
    {
      title: '创建者',
      dataIndex: ['operator', 'realName'],
      search: false,
      render: (_, record) => record.operator?.realName || record.operator?.userCode || '-',
    },
    {
      title: '更新时间',
      dataIndex: 'updateTime',
      search: false,
      width: 150,
      render: (_, record) => <span style={{color: token.colorTextSecondary, fontSize: 12}}>{formatTime(record.updateTime)}</span>,
    },
    {
      title: '操作',
      dataIndex: 'option',
      valueType: 'option',
      width: 220,
      fixed: 'right',
      className: 'option-wrap',
      render: (_, record) => {
        let isBuiltIn = record.ragType === 'builtIn'
        return [
          <a key='view' onClick={() => editRef?.current?.show({...record, viewer: true})}>查看</a>,
          !isBuiltIn && canEditOf(record) ? <a key='edit' onClick={() => editRef?.current?.show({...record})}>编辑</a> : null,
          !isBuiltIn ? <a key='conf' onClick={() => toDetailOf(record)}>配置</a> : null,
          !isBuiltIn && isOwnerOf(record) && record.status === 0 ? <a key='disable' onClick={() => doToggleStatus(record, false)}>禁用</a> : null,
          !isBuiltIn && isOwnerOf(record) && record.status === 1 ? <a key='enable' onClick={() => doToggleStatus(record, true)}>启用</a> : null,
          !isBuiltIn && isOwnerOf(record) ? <a key='delete' style={{color: '#ff4d4f'}} onClick={() => confirmDelete(record)}>删除</a> : null,
        ]
      },
    },
  ]

  const applyCond = () => {
    setTimeout(() => {
      if (viewMode === 'card') {
        loadCards(1)
      } else {
        actionRef.current?.reloadAndRest?.()
      }
    }, 0)
  }

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
          if (!e.target.value) applyCond()
        }}
        onPressEnter={applyCond}
      />
      <Select
        value={statusFilter}
        style={{width: 120}}
        onChange={v => {
          setStatusFilter(v)
          applyCond()
        }}
        options={[
          {label: '全部状态', value: 'all'},
          {label: '正常使用', value: '0'},
          {label: '已禁用', value: '1'},
        ]}
      />
      <Select
        value={sortKey}
        style={{width: 130}}
        onChange={v => {
          setSortKey(v)
          applyCond()
        }}
        options={[
          {label: '最近更新', value: 'updateTime'},
          {label: '最近创建', value: 'insertTime'},
          {label: '按标题', value: 'title'},
        ]}
      />
      <Button icon={<ReloadOutlined/>} onClick={reload}>刷新</Button>
      <Segmented
        value={viewMode}
        onChange={v => {
          const mode = v as string
          setViewMode(mode)
          try {
            localStorage.setItem(VIEW_KEY, mode)
          } catch (e) {
          }
        }}
        options={[
          {value: 'card', icon: <AppstoreOutlined/>},
          {value: 'table', icon: <BarsOutlined/>},
        ]}
      />
      <Button type='primary' icon={<PlusOutlined/>} onClick={() => editRef?.current?.show()}>添加知识库</Button>
    </Space>
  )

  const renderCard = (record: any) => {
    let isBuiltIn = record.ragType === 'builtIn'
    let myType = getMyMemberType(record)
    let menu = cardMenuItems(record)
    return (
      <div
        key={record.ragCode}
        onClick={() => toDetailOf(record)}
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
          {isBuiltIn ? <Tag color='gold' bordered={false} style={{marginInlineEnd: 0}}>内置</Tag> : null}
        </div>
        <Typography.Paragraph type='secondary' style={{fontSize: 13, marginBottom: 0, minHeight: 42}} ellipsis={{rows: 2, tooltip: record.description}}>
          {record.description || '暂无描述'}
        </Typography.Paragraph>
        <div style={{display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center'}}>
          <PermissionTag permission={record.permission}/>
          <CodeTag text={record.embeddingModelId} title={`${record.embeddingModelProvider || ''} ${record.embeddingModelId || ''}`.trim()}/>
          <Tooltip title='成员数'>
            <span style={{fontSize: 12, color: token.colorTextSecondary}}><TeamOutlined/> {record.members?.length ?? 0}</span>
          </Tooltip>
          {showMemberRoleColumn && myType ? <MemberTypeTag memberType={myType}/> : null}
        </div>
        <div style={{marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: token.colorTextQuaternary, fontSize: 12}}>
          <span>{record.operator?.realName || record.operator?.userCode || '-'} · {formatTime(record.updateTime)}</span>
          <Space size={4} onClick={e => e.stopPropagation()}>
            <Tooltip title='查看详情'>
              <Button size='small' type='text' icon={<EyeOutlined/>} onClick={() => editRef?.current?.show({...record, viewer: true})}/>
            </Tooltip>
            {!isBuiltIn ? <Tooltip title='配置管理'>
              <Button size='small' type='text' icon={<SettingOutlined/>} onClick={() => toDetailOf(record)}/>
            </Tooltip> : null}
            {menu ? <Dropdown menu={{items: menu}} trigger={['click']}>
              <Button size='small' type='text' icon={<MoreOutlined/>}/>
            </Dropdown> : null}
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
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
              gap: 16,
            }}>
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
          </> : <Empty style={{padding: '60px 0'}} description={keyword || statusFilter !== 'all' ? '没有匹配的知识库' : '还没有知识库，点击右上角“添加知识库”创建'}/>}
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
            const cond = condRef.current
            let filter: any = {}
            if (cond.keyword.trim()) filter.title = cond.keyword.trim()
            if (cond.statusFilter !== 'all') filter.status = Number(cond.statusFilter)
            if (paramsIn.ragCode) filter.ragCode = paramsIn.ragCode
            let data = await getRagInfoList(paramsIn.current, paramsIn.pageSize, filter, {sort: {[cond.sortKey]: cond.sortKey === 'title' ? 1 : -1}}, apiRelativeUrls?.getRagInfoList)
            return {
              data: data.rows,
              total: data.total,
              success: true
            }
          }}
        />
      </>}
      <Edit ref={editRef} onEditFinish={localEditFinish} apiRelativeUrls={apiRelativeUrls} addHideRagCode={addHideRagCode} canSetPermission={canSetPermission}/>
    </PageContainer>
  )
}

export default RagInfoList
