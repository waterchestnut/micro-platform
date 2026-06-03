import React, {useEffect, useState} from 'react'
import {ProCard} from '@ant-design/pro-components'
import {Avatar, List, Select, Space, Tag, Typography} from 'antd'
import {getOperationLogList} from '@/services/rag/ragOperationLog'
import LogTypeEnum from '@/enum/LogTypeEnum'
import MemberTypeEnum from '@/enum/MemberTypeEnum'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  FileAddOutlined,
  LogoutOutlined,
  SendOutlined,
  SwapOutlined,
  UserDeleteOutlined,
  UserAddOutlined,
} from '@ant-design/icons'

export type OperationLogProps = {
  pRagInfo?: any;
  apiRelativeUrls?: any;
};

const logTypeStyleConfig: Record<string, {color: string; icon: React.ReactNode}> = {
  member_join: {color: 'green', icon: <UserAddOutlined/>},
  member_apply: {color: 'blue', icon: <SendOutlined/>},
  application_approve: {color: 'green', icon: <CheckCircleOutlined/>},
  application_reject: {color: 'red', icon: <CloseCircleOutlined/>},
  material_add: {color: 'cyan', icon: <FileAddOutlined/>},
  material_delete: {color: 'orange', icon: <DeleteOutlined/>},
  member_quit: {color: 'default', icon: <LogoutOutlined/>},
  member_remove: {color: 'volcano', icon: <UserDeleteOutlined/>},
  member_role_change: {color: 'purple', icon: <SwapOutlined/>},
}

const OperationLog: React.FC<OperationLogProps> = (props) => {
  const {pRagInfo, apiRelativeUrls} = props
  const [logs, setLogs] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [pageIndex, setPageIndex] = useState(1)
  const [loading, setLoading] = useState(false)
  const [logType, setLogType] = useState<string | undefined>(undefined)
  const pageSize = 20

  const loadLogs = async (page = 1, type?: string) => {
    if (!pRagInfo?.ragCode) return
    setLoading(true)
    let data = await getOperationLogList(pRagInfo.ragCode, page, pageSize, type, apiRelativeUrls?.getOperationLogList)
    setLogs(data.rows || [])
    setTotal(data.total || 0)
    setPageIndex(page)
    setLoading(false)
  }

  useEffect(() => {
    loadLogs(1, logType)
  }, [pRagInfo?.ragCode])

  const handleTypeChange = (value: string | undefined) => {
    setLogType(value)
    loadLogs(1, value)
  }

  const formatTime = (time: string) => {
    if (!time) return ''
    let d = new Date(time)
    let pad = (n: number) => n < 10 ? '0' + n : '' + n
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }

  const renderRoleChangeDetail = (detail: any) => {
    if (!detail) return null
    let fromLabel = MemberTypeEnum.toLabel(detail.fromType) || detail.fromType
    let toLabel = MemberTypeEnum.toLabel(detail.toType) || detail.toType
    return <Typography.Text type='secondary'> （{fromLabel} → {toLabel}）</Typography.Text>
  }

  return (
    <ProCard>
      <div style={{marginBottom: 16}}>
        <Space>
          <span>操作类型：</span>
          <Select
            allowClear
            placeholder='全部'
            style={{width: 160}}
            value={logType}
            onChange={handleTypeChange}
            options={LogTypeEnum.toOptions()}
          />
        </Space>
      </div>
      <List
        loading={loading}
        itemLayout='horizontal'
        dataSource={logs}
        pagination={{
          current: pageIndex,
          pageSize,
          total,
          showSizeChanger: false,
          showTotal: (total) => `共 ${total} 条`,
          onChange: (page) => loadLogs(page, logType),
        }}
        locale={{emptyText: '暂无操作日志'}}
        renderItem={(item: any) => {
          let label = LogTypeEnum.toLabel(item.logType) || item.logType
          let style = logTypeStyleConfig[item.logType] || {color: 'default', icon: null}
          return (
            <List.Item>
              <List.Item.Meta
                avatar={<Avatar style={{backgroundColor: '#f0f0f0', color: '#666'}} icon={style.icon}/>}
                title={
                  <Space>
                    <Tag color={style.color}>{label}</Tag>
                    <span>{item.description}</span>
                    {item.logType === 'member_role_change' && renderRoleChangeDetail(item.detail)}
                  </Space>
                }
                description={
                  <Space size='large'>
                    <Typography.Text type='secondary'>
                      操作人：{item.operator?.realName || '未知'}
                    </Typography.Text>
                    <Typography.Text type='secondary'>
                      {formatTime(item.insertTime)}
                    </Typography.Text>
                  </Space>
                }
              />
            </List.Item>
          )
        }}
      />
    </ProCard>
  )
}

export default OperationLog
