import {PageContainer} from '@ant-design/pro-components'
import {useModel} from '@umijs/max'
import {Card, theme, Spin} from 'antd'
import React, {useEffect, useState} from 'react'
import {statClientByTagIpmi, statClientByTagMy} from '@/services/app/client'
import {Column} from '@ant-design/charts'
import {checkPermissions} from '@/utils/authority'

interface TagStatData {
  key: string;
  value: string;
  count: number;
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

  const renderChart = (title: string, data: TagStatData[], loading: boolean) => {
    const config = {
      data: data.map(_ => ({tag: _.value, '应用数量': _.count})),
      xField: 'tag',
      yField: '应用数量',
      label: {
        position: 'top' as const,
      },
      style: {
        fill: token.colorPrimary
      }
    }

    return (
      <Card
        title={title}
        style={{
          borderRadius: 8,
          marginBottom: 16,
        }}
      >
        <Spin spinning={loading}>
          <div style={{height: 300}}>
            {data.length > 0 ? <Column {...config} /> :
              <div style={{color: token.colorTextDisabled, textAlign: 'center', lineHeight: '300px'}}>暂无数据</div>}
          </div>
        </Spin>
      </Card>
    )
  }

  return (
    <PageContainer>
      {renderChart('我创建的应用统计', myData, myLoading)}
      {canViewIpmi && renderChart('全部应用统计', ipmiData, ipmiLoading)}
    </PageContainer>
  )
}

export default Home
