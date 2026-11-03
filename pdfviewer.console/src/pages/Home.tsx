import {PageContainer, ProCard, ProList} from '@ant-design/pro-components'
import {useModel, history} from '@umijs/max'
import {Button, Card, Col, Row, Tag, theme, Tooltip, Typography} from 'antd'
import {HistoryOutlined} from '@ant-design/icons'
import React from 'react'
import {getToReadResList} from '@/services/resource/resInfo'
import ResTypeEnum from '@/enum/ResTypeEnum'
import {createStyles} from 'antd-style'

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

const useStyles = createStyles(({token}) => {
  return {
    container: {
    },
  }
})

const Home: React.FC = () => {
  const {token} = theme.useToken()
  const {initialState} = useModel('@@initialState')
  const {styles} = useStyles()
  const currentUser = initialState?.currentUser
  const userName = currentUser?.realName || currentUser?.nickName || currentUser?.userCode || ''

  return (
    <>
      {/* 欢迎横幅 */}
      <Card
        style={{
          borderRadius: 12,
          marginBottom: 16,
          background: `linear-gradient(135deg, ${token.colorPrimaryBg} 0%, ${token.colorBgContainer} 55%, ${token.colorFillQuaternary} 100%)`,
        }}
        styles={{body: {padding: '20px 28px'}}}
      >
        <Row align="middle" justify="space-between" gutter={[16, 16]}>
          <Col flex="auto">
            <div style={{fontSize: 20, fontWeight: 600, marginBottom: 4}}>
              {getGreeting()}，{userName}
            </div>
            <div style={{color: token.colorTextSecondary, fontSize: 13}}>
              {formatDate()} · 待读文献一站检索，支持在线阅读、AI 分析与翻译
            </div>
          </Col>
          <Col flex="none">
            <Button icon={<HistoryOutlined/>} onClick={() => history.push('/history')}>
              阅读历史
            </Button>
          </Col>
        </Row>
      </Card>
      <ProCard className={styles.container}>
      <ProList<any>
        ghost={true}
        itemCardProps={{
          ghost: true,
        }}
        pagination={{
          defaultPageSize: 10,
          showSizeChanger: false,
        }}
        rowSelection={false}
        itemLayout='vertical'
        onItem={(record: any) => {
          return {
            onMouseEnter: () => {
              /*console.log(record)*/
            },
            onClick: () => {
              /*console.log(record)*/
            },
          }
        }}
        columns={[
          {
            dataIndex: 'keyword',
            listSlot: 'title',
            key: 'keyword',
            colSize: 3,
            fieldProps: {placeholder: '请输入资源的名称、作者、关键词查询'},
            render: (doc, record) => {
              return <div>
                <Tag color='#5BD8A6'
                     style={{marginRight: '8px'}}>{ResTypeEnum.toLabel(record.resType)}</Tag>
                <a
                  onClick={() => {
                    history.push(`/viewer/${record.resCode}`)
                  }}
                >{record.title}</a>
              </div>
            }
          },
          {
            listSlot: 'content',
            render: (dom, record) => {
              let publish = []
              if (record.publishDate) {
                publish.push(record.publishDate)
              }
              if (record.publisher) {
                publish.push(record.publisher)
              }
              return (
                <div>
                  <Typography.Paragraph
                    style={{height: '44px'}}
                    title={(record.author || []).join('/')}
                    ellipsis={{
                      rows: 2,
                    }}>{(record.author || []).join('/')}</Typography.Paragraph>
                  <Typography.Paragraph
                    style={{height: '44px'}}
                    title={publish.join('/')}
                    ellipsis={{
                      rows: 2,
                    }}>{publish.join('/')}</Typography.Paragraph>
                  <Typography.Paragraph
                    style={{height: '66px'}}
                    ellipsis={{
                      rows: 3,
                    }}
                  >
                    {record.abstract}
                  </Typography.Paragraph>
                </div>
              )
            },
            search: false
          },
        ]}
        search={{}}
        rowKey='resCode'
        headerTitle=''
        request={
          async (paramsIn) => {
            let filter = {...paramsIn}
            delete filter.current
            delete filter.pageSize

            let data = await getToReadResList(paramsIn.current, paramsIn.pageSize, filter, {})
            return {
              data: data.rows,
              total: data.total,
              success: true
            }
          }
        }
      />
    </ProCard>
    </>
  )
}

export default Home
