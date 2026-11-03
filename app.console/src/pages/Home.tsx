import {PageContainer} from '@ant-design/pro-components'
import {history, useModel} from '@umijs/max'
import {Button, Card, Col, Empty, Row, Skeleton, Space, Statistic, Tag, theme} from 'antd'
import {
  AppstoreAddOutlined,
  AppstoreOutlined,
  FundOutlined,
  RightOutlined,
  TagsOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import React, {useEffect, useMemo, useState} from 'react'
import {statClientByTagIpmi, statClientByTagMy} from '@/services/app/client'
import {Column, Pie} from '@ant-design/charts'
import {checkPermissions} from '@/utils/authority'

interface TagStatData {
  key: string;
  value: string;
  count: number;
}

/** 按小时段的问候语 */
const getGreeting = () => {
  const hour = new Date().getHours()
  if (hour < 6) return '夜深了'
  if (hour < 12) return '早上好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

/** 中文长日期，不引入 dayjs 依赖 */
const formatDate = () => {
  const d = new Date()
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 星期${'日一二三四五六'[d.getDay()]}`
}

const Home: React.FC = () => {
  const {token} = theme.useToken()
  const {initialState} = useModel('@@initialState')
  const [ipmiData, setIpmiData] = useState<TagStatData[]>([])
  const [myData, setMyData] = useState<TagStatData[]>([])
  const [ipmiLoading, setIpmiLoading] = useState(true)
  const [myLoading, setMyLoading] = useState(true)

  const currentUser = initialState?.currentUser
  const canViewIpmi = checkPermissions(['app-ipmi-client-browse'], currentUser?.privs)
  const canManageMyClient = checkPermissions(['app-myclient-browse'], currentUser?.privs)
  const canBrowseAllClients = checkPermissions(['app-ipmiclient-browse'], currentUser?.privs)

  const fetchMyStatData = async () => {
    try {
      const result = await statClientByTagMy()
      if (result) {
        setMyData(result)
      }
    } catch (error) {
      console.error('获取我的统计数据失败:', error)
    } finally {
      setMyLoading(false)
    }
  }

  const fetchIpmiStatData = async () => {
    try {
      const result = await statClientByTagIpmi()
      if (result) {
        setIpmiData(result)
      }
    } catch (error) {
      console.error('获取全部应用统计数据失败:', error)
    } finally {
      setIpmiLoading(false)
    }
  }

  useEffect(() => {
    fetchMyStatData()
  }, [])

  useEffect(() => {
    if (canViewIpmi) {
      fetchIpmiStatData()
    } else {
      setIpmiLoading(false)
    }
  }, [canViewIpmi])

  const myTotal = useMemo(() => myData.reduce((sum, _) => sum + _.count, 0), [myData])
  const ipmiTotal = useMemo(() => ipmiData.reduce((sum, _) => sum + _.count, 0), [ipmiData])
  const topTag = useMemo(() => {
    if (!myData.length) return null
    return myData.reduce((max, _) => (_.count > max.count ? _ : max), myData[0])
  }, [myData])

  const userName = currentUser?.realName || currentUser?.nickName || currentUser?.userCode || ''

  /** 概览指标卡 */
  const renderKpi = (title: string, value: React.ReactNode, icon: React.ReactNode, color: string, suffix?: string) => (
    <Card
      bordered={false}
      style={{borderRadius: 12, height: '100%'}}
      styles={{body: {padding: '20px 24px'}}}
    >
      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
        <Statistic title={title} value={value as any} suffix={suffix} valueStyle={{fontWeight: 600}}/>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 22,
            color,
            background: `${color}1a`,
          }}
        >
          {icon}
        </div>
      </div>
    </Card>
  )

  /** 图表卡片外壳：骨架屏 + 空态 */
  const renderChartCard = (
    title: string,
    loading: boolean,
    data: TagStatData[],
    chart: React.ReactNode,
    options?: {emptyAction?: React.ReactNode},
  ) => (
    <Card
      title={title}
      bordered={false}
      style={{borderRadius: 12, height: '100%'}}
      styles={{body: {paddingBlock: 12}}}
    >
      <Skeleton loading={loading} active paragraph={{rows: 6}}>
        {data.length > 0 ? (
          <div style={{height: 300}}>{chart}</div>
        ) : (
          <Empty
            style={{padding: '60px 0'}}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={<span style={{color: token.colorTextDescription}}>暂无应用数据</span>}
          >
            {options?.emptyAction}
          </Empty>
        )}
      </Skeleton>
    </Card>
  )

  const columnConfig = (data: TagStatData[], color?: string) => ({
    data: data.map(_ => ({tag: _.value, '应用数量': _.count})),
    xField: 'tag',
    yField: '应用数量',
    columnWidthRatio: 0.45,
    label: {
      position: 'top' as const,
    },
    style: {
      fill: color ?? token.colorPrimary,
      radius: [6, 6, 0, 0] as number[],
    },
    interaction: {tooltip: {shared: true}},
    axis: {y: {labelFormatter: (v: number) => `${v}`}},
  })

  const pieConfig = {
    data: myData.map(_ => ({tag: _.value, count: _.count})),
    angleField: 'count',
    colorField: 'tag',
    radius: 0.9,
    innerRadius: 0.62,
    label: {
      text: (d: {count: number}) => `${d.count}`,
      position: 'outside' as const,
    },
    legend: {
      color: {
        position: 'right' as const,
        itemMarker: 'circle' as const,
      },
    },
    tooltip: {
      items: [
        (d: {tag: string; count: number}) => ({
          name: d.tag,
          value: `${d.count} 个应用`,
        }),
      ],
    },
  }

  const kpiSpan = canViewIpmi ? 6 : 8

  return (
    <PageContainer>
      {/* 欢迎横幅 */}
      <Card
        bordered={false}
        style={{
          borderRadius: 12,
          marginBottom: 16,
          background: `linear-gradient(135deg, ${token.colorPrimaryBg} 0%, ${token.colorBgContainer} 55%, ${token.colorFillQuaternary} 100%)`,
        }}
        styles={{body: {padding: '24px 28px'}}}
      >
        <Row align="middle" justify="space-between" gutter={[16, 16]}>
          <Col flex="auto">
            <div style={{fontSize: 22, fontWeight: 600, marginBottom: 6}}>
              {getGreeting()}，{userName}
            </div>
            <div style={{color: token.colorTextSecondary}}>
              {formatDate()} · 这里是你的应用门户工作台，汇总了你参与应用与全平台应用的分类概况
            </div>
          </Col>
          {(canManageMyClient || canBrowseAllClients) && (
            <Col flex="none">
              <Space>
                {canManageMyClient && (
                  <Button
                    type="primary"
                    icon={<AppstoreAddOutlined/>}
                    onClick={() => history.push('/my-client/list')}
                  >
                    管理我的应用
                  </Button>
                )}
                {canBrowseAllClients && (
                  <Button icon={<AppstoreOutlined/>} onClick={() => history.push('/client/list')}>
                    浏览应用市场
                  </Button>
                )}
              </Space>
            </Col>
          )}
        </Row>
      </Card>

      {/* 概览指标 */}
      <Row gutter={[16, 16]} style={{marginBottom: 16}}>
        <Col xs={12} md={kpiSpan}>
          <Skeleton loading={myLoading} active paragraph={{rows: 1}}>
            {renderKpi('我创建的应用', myTotal, <AppstoreOutlined/>, token.colorPrimary, myTotal > 0 ? '个' : undefined)}
          </Skeleton>
        </Col>
        <Col xs={12} md={kpiSpan}>
          <Skeleton loading={myLoading} active paragraph={{rows: 1}}>
            {renderKpi('覆盖应用分类', myData.length, <TagsOutlined/>, '#722ed1', myData.length > 0 ? '类' : undefined)}
          </Skeleton>
        </Col>
        <Col xs={12} md={kpiSpan}>
          <Skeleton loading={myLoading} active paragraph={{rows: 1}}>
            {topTag ? (
              renderKpi(
                '最活跃分类',
                <Tag color="processing" style={{fontSize: 16, padding: '2px 12px', marginInlineEnd: 0}}>
                  {topTag.value}
                </Tag>,
                <FundOutlined/>,
                '#fa8c16',
              )
            ) : (
              renderKpi('最活跃分类', '—', <FundOutlined/>, '#fa8c16')
            )}
          </Skeleton>
        </Col>
        {canViewIpmi && (
          <Col xs={12} md={kpiSpan}>
            <Skeleton loading={ipmiLoading} active paragraph={{rows: 1}}>
              {renderKpi('全平台应用', ipmiTotal, <TeamOutlined/>, '#13c2c2', ipmiTotal > 0 ? '个' : undefined)}
            </Skeleton>
          </Col>
        )}
      </Row>

      {/* 我的应用分布：柱状 + 环形 */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          {renderChartCard('我创建的应用分类分布', myLoading, myData, <Column {...columnConfig(myData)}/>, {
            emptyAction: canManageMyClient ? (
              <Button type="primary" size="small" onClick={() => history.push('/my-client/list')}>
                去创建应用 <RightOutlined/>
              </Button>
            ) : undefined,
          })}
        </Col>
        <Col xs={24} lg={12}>
          {renderChartCard('我创建的应用分类占比', myLoading, myData, (
            <div style={{position: 'relative', height: '100%'}}>
              <Pie {...pieConfig}/>
              {/* 环心汇总，不依赖图表库注记 API */}
              <div
                style={{
                  position: 'absolute',
                  top: '45%',
                  left: 0,
                  right: 0,
                  transform: 'translateY(-50%)',
                  textAlign: 'center',
                  pointerEvents: 'none',
                }}
              >
                <div style={{fontSize: 26, fontWeight: 600}}>{myTotal}</div>
                <div style={{fontSize: 12, color: token.colorTextSecondary}}>应用总数</div>
              </div>
            </div>
          ))}
        </Col>
      </Row>

      {/* 全平台分布 */}
      {canViewIpmi && (
        <Row gutter={[16, 16]} style={{marginTop: 16}}>
          <Col span={24}>
            {renderChartCard('全平台应用分类分布', ipmiLoading, ipmiData, <Column {...columnConfig(ipmiData, '#13c2c2')}/>)}
          </Col>
        </Row>
      )}
    </PageContainer>
  )
}

export default Home
