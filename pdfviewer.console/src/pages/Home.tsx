import {PageContainer, ProCard, ProList} from '@ant-design/pro-components'
import {useModel, history} from '@umijs/max'
import {Card, Tag, theme, Tooltip, Typography} from 'antd'
import React from 'react'
import {getToReadResList} from '@/services/resource/resInfo'
import ResTypeEnum from '@/enum/ResTypeEnum'
import {createStyles} from 'antd-style'

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

  return (
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
  )
}

export default Home
