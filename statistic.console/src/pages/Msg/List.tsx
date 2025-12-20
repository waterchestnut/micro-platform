import React, {createRef, useRef} from 'react'
import {type ActionType, PageContainer, ProColumns} from '@ant-design/pro-components'
import ProTableWrapper from '@/components/ProTableWrapper'
import {queryMsgList} from '@/services/statistic/msgSearch'
import Viewer, {ViewerAction} from './components/Viewer'
import dayjs from 'dayjs'
import ReactJsonView from '@microlink/react-json-view'

const MsgList: React.FC = () => {
  const actionRef = useRef<ActionType>()
  const viewerRef = createRef<ViewerAction>()

  const localEditFinish = async () => {
    actionRef.current?.reloadAndRest?.()
  }

  const columns: ProColumns[] = [
    {
      title: '日志标识',
      dataIndex: 'msgCode',
    },
    {
      title: '日志类型',
      dataIndex: 'operateType',
    },
    {
      title: '日志摘要',
      dataIndex: 'content_msg',
      width: 560,
      render: (_, record) => {
        if (!record.content_msg) {
          return '-'
        }
        try {
          return (
            <ReactJsonView
              src={JSON.parse(record.content_msg)}
            />
          )
        } catch (e) {
          return record.content_msg
        }
      },
      key: 'commonMatch',
    },
    {
      title: '发生时间',
      dataIndex: 'browseTime',
      valueType: 'dateTimeRange',
      render: (_, record) => {
        if (!record.browseTime) {
          return '-'
        }
        return dayjs(record.browseTime).format('YYYY-MM-DD HH:mm:ss')
      },
      sorter: {},
      defaultSortOrder: 'descend',
    },
    {
      title: '登录用户',
      dataIndex: 'realName',
    },
    {
      title: '子系统',
      dataIndex: 'clientName',
    },
    {
      title: '程序',
      dataIndex: 'sysName',
    },
    {
      title: '操作',
      dataIndex: 'option',
      valueType: 'option',
      width: 80,
      fixed: 'right',
      className: 'option-wrap',
      render: (_, record) => [
        <a
          key='view'
          onClick={() => {
            viewerRef?.current?.show(record)
          }}
        >
          详情
        </a>,
      ],
    },
  ]

  return (
    <PageContainer>
      <ProTableWrapper
        columns={columns}
        rowKey='msgCode'
        actionRef={actionRef}
        search={{
          defaultCollapsed: false
        }}
        request={async (paramsIn, sorter, filterIn) => {
          /*console.log(paramsIn, sorter, filterIn);*/
          let queryParams = {...paramsIn}
          delete queryParams.current
          delete queryParams.pageSize
          delete queryParams.handleSecretary

          let filterParams = {...filterIn}
          let sort = []
          for (let key in sorter) {
            sort.push([key, sorter[key]?.startsWith('desc') ? 'desc' : 'asc'])
          }

          let data = await queryMsgList(queryParams, filterParams, sort, paramsIn.current, paramsIn.pageSize)
          return {
            data: data.rows,
            total: data.total,
            success: true
          }
        }}
      />
      <Viewer ref={viewerRef}/>
    </PageContainer>
  )
}

export default MsgList
