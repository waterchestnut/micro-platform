import {ActionType, PageContainer, ProCard, ProList} from '@ant-design/pro-components'
import {useModel, useParams, history} from '@umijs/max'
import {App, Button, Card, Popconfirm, Tag, theme, Tooltip, Typography} from 'antd'
import React, {useRef, useState} from 'react'
import ResTypeEnum from '@/enum/ResTypeEnum'
import {getMyReadResList} from '@/services/resource/resInfo'
import {createStyles} from 'antd-style'
import {
  CommentOutlined,
  DeleteOutlined,
  HistoryOutlined,
  LikeOutlined,
  MessageOutlined,
  StarOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import {statConversationByChannelGroup} from '@/services/llm/conversation'
import {removeLiterature} from '@/services/resource/literature'

const useStyles = createStyles(({token}) => {
  return {
    container: {
      '.ant-pro-list-row': {
        paddingInline: '8px'
      }
    },
  }
})

const IconText = ({icon, text}: { icon: any; text: string }) => (
  <span>
    {React.createElement(icon, {style: {marginInlineEnd: 8}})}
    {text}
  </span>
)

const History: React.FC = () => {
  const {token} = theme.useToken()
  const {initialState} = useModel('@@initialState')
  const {styles} = useStyles()
  const [stats, setStats] = useState<any[]>([])
  const {message} = App.useApp()
  const actionRef = useRef<ActionType>()

  async function loadStats(resCodes: any[]) {
    if (!resCodes?.length) {
      return setStats([])
    }
    let list = await statConversationByChannelGroup('pdfviewer_literature', resCodes)
    setStats(list)
  }

  return (
    <ProCard className={styles.container}>
      <ProList<any>
        actionRef={actionRef}
        ghost={true}
        itemCardProps={{
          ghost: true,
        }}
        pagination={{
          defaultPageSize: 8,
          showSizeChanger: false,
        }}
        showActions='always'
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
        metas={{
          title: {
            key: 'keyword',
            // @ts-ignore
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
          content: {
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
                    title={(record.author || []).join('/')}
                    ellipsis={{
                      rows: 2,
                    }}>{(record.author || []).join('/')}</Typography.Paragraph>
                  <Typography.Paragraph
                    title={publish.join('/')}
                    ellipsis={{
                      rows: 2,
                    }}>{publish.join('/')}</Typography.Paragraph>
                  <Typography.Paragraph
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
          description: {
            search: false,
            render: (dom, record) => (
              record.keywords?.map((_: string) => (<Tag key={_}>{_}</Tag>))
            ),
          },
          actions: {
            render: (dom, record) => {
              let stat = stats.find((item: any) => item.channel === 'pdfviewer_literature' && item.channelGroup === record.resCode)
              /*console.log(stats, stat)*/
              return (
                [
                  <IconText
                    icon={HistoryOutlined}
                    text={dayjs(record.latestReadTime).format('YYYY-MM-DD HH:mm')}
                    key='readtime'
                  />,
                  <IconText
                    icon={CommentOutlined}
                    text={stat?.conversationCount || 0}
                    key='conversation'
                  />,
                  <IconText
                    icon={MessageOutlined}
                    text={stat?.messageCount || 0}
                    key='message'
                  />,
                  <Popconfirm
                    key='delete'
                    title='删除阅读记录'
                    description='确定要删除这条阅读记录吗？'
                    onConfirm={async () => {
                      let ret = await removeLiterature(record.resCode)
                      if (ret.code !== 0) {
                        message.error(`移除失败 ${ret.msg}`)
                        return
                      }
                      message.success('移除成功')
                      await actionRef.current?.reload?.()
                    }}
                    okText='确定'
                    cancelText='取消'
                  >
                    <Button
                      type='text'
                      danger
                      icon={
                        <DeleteOutlined
                        />
                      }
                    />
                  </Popconfirm>,
                ]
              )
            },
          },
        }}
        search={{}}
        rowKey='resCode'
        headerTitle=''
        request={
          async (paramsIn) => {
            let filter = {...paramsIn}
            delete filter.current
            delete filter.pageSize

            let data = await getMyReadResList(paramsIn.current, paramsIn.pageSize, filter, {})
            let resCodes = data.rows?.map((_: any) => _.resCode)
            loadStats(resCodes)
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

export default History
