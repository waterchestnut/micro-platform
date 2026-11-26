import React, {createRef, useRef} from 'react'
import {ActionType, ProColumns} from '@ant-design/pro-components'
import ProTableWrapper from '@/components/ProTableWrapper'
import {deleteRagMaterial, getRagMaterialList} from '@/services/rag/ragMaterial'
import {history} from '@@/core/history'
import MaterialEdit, {MaterialEditAction} from '@/pages/Rag/components/MaterialEdit'
import {Button, Popconfirm, Space, Tag, Tooltip, Typography} from 'antd'
import {LinkOutlined} from '@ant-design/icons'
import {errorMessage, successMessage} from '@/utils/msg'
import {formatTime, HandleStatusTag} from '../ragMeta'

export type MaterialManageProps = {
  pRagInfo?: any;
  apiRelativeUrls?: any;
  toDetail?: (ragCode: string, ragMaterialCode: string) => void;
  canEdit?: boolean;
};

const MaterialManage: React.FC<MaterialManageProps> = (props) => {
  const {pRagInfo, apiRelativeUrls, toDetail, canEdit = true} = props
  const actionRef = useRef<ActionType>()
  const materialEditRef = createRef<MaterialEditAction>()

  const localEditFinish = async () => {
    actionRef.current?.reloadAndRest?.()
  }

  const toDetailOf = (record: any) => {
    if (toDetail) {
      toDetail(record.ragCode, record.ragMaterialCode)
    } else {
      history.push(`${location.pathname.startsWith('/lite/') ? '/lite' : ''}/rag/detail/${record.ragCode}/${record.ragMaterialCode}`)
    }
  }

  const columns: ProColumns[] = [
    {
      title: '材料标题',
      dataIndex: 'resTitle',
      render: (_, record) => (
        <Space size={4}>
          <a onClick={() => toDetailOf(record)}>{record.resTitle || record.ragMaterialCode}</a>
          {record.resOriginalUrl ? (
            <Tooltip title='查看原文'>
              <a href={record.resOriginalUrl} target='_blank' rel='noreferrer' onClick={e => e.stopPropagation()}>
                <LinkOutlined style={{fontSize: 12, color: 'rgba(0,0,0,0.35)'}}/>
              </a>
            </Tooltip>
          ) : null}
        </Space>
      ),
    },
    {
      title: '材料标识',
      dataIndex: 'ragMaterialCode',
      ellipsis: true,
      width: 200,
      render: (_, record) => (
        <Typography.Text copyable={{text: record.ragMaterialCode}} style={{fontSize: 12, color: 'rgba(0,0,0,0.45)'}} ellipsis>
          {record.ragMaterialCode}
        </Typography.Text>
      ),
    },
    {
      title: '格式',
      dataIndex: 'format',
      search: false,
      width: 80,
      render: (_, record) => record.format ? <Tag bordered={false} style={{fontFamily: 'monospace'}}>{String(record.format).toLowerCase()}</Tag> : '-',
    },
    {
      title: '处理状态',
      dataIndex: 'handleStatus',
      search: false,
      width: 100,
      render: (_, record) => <HandleStatusTag handleStatus={record.handleStatus} handleError={record.handleError}/>,
    },
    {
      title: '备注',
      dataIndex: 'description',
      search: false,
      ellipsis: true,
      render: (_, record) => <span style={{color: 'rgba(0,0,0,0.45)', fontSize: 12}}>{record.description || '-'}</span>,
    },
    {
      title: '创建者',
      dataIndex: ['operator', 'realName'],
      search: false,
      width: 100,
      render: (_, record) => record.operator?.realName || record.operator?.userCode || '-',
    },
    {
      title: '更新时间',
      dataIndex: 'updateTime',
      search: false,
      width: 140,
      render: (_, record) => <span style={{color: 'rgba(0,0,0,0.45)', fontSize: 12}}>{formatTime(record.updateTime)}</span>,
    },
    {
      title: '操作',
      dataIndex: 'option',
      valueType: 'option',
      width: 160,
      fixed: 'right',
      className: 'option-wrap',
      render: (_, record) => {
        let actions: React.ReactNode[] = [
          <a key='detail' onClick={() => toDetailOf(record)}>材料片段</a>,
        ]
        if (canEdit) {
          actions.push(
            <a
              key='edit'
              onClick={() => {
                materialEditRef?.current?.show({...record})
              }}
            >
              编辑
            </a>,
            <Popconfirm
              title='确定要删除该材料吗？'
              onConfirm={async () => {
                let ret = await deleteRagMaterial(record.ragMaterialCode, apiRelativeUrls?.deleteRagMaterial, pRagInfo.ragCode)
                if (ret.code !== 0) {
                  let msg = ret.msg || '删除失败，请稍后再试'
                  return errorMessage(msg)
                }
                successMessage('删除材料成功')
                actionRef?.current?.reloadAndRest?.()
              }}
              okText='确定'
              cancelText='取消'
              key='delete'
            >
              <a href='#' style={{color: '#ff4d4f'}}>删除</a>
            </Popconfirm>,
          )
        }
        return actions
      },
    },
  ]
  return (
    <>
      <ProTableWrapper
        columns={columns}
        rowKey='ragMaterialCode'
        actionRef={actionRef}
        pagination={{hideOnSinglePage: true, pageSize: 20}}
        request={async (paramsIn, sorter, filterIn) => {
          let filter = {...paramsIn, ragCode: pRagInfo.ragCode}
          delete filter.current
          delete filter.pageSize
          let data = await getRagMaterialList(paramsIn.current, paramsIn.pageSize, filter, {sort: {updateTime: -1}}, apiRelativeUrls?.getRagMaterialList, pRagInfo.ragCode)
          return {
            data: data.rows,
            total: data.total,
            success: true
          }
        }}
        toolBarRender={() => canEdit ? [
          <Button type='primary' key='add' onClick={() => {
            materialEditRef?.current?.show()
          }}>
            上传材料
          </Button>,
        ] : []}
      />
      <MaterialEdit ref={materialEditRef} onEditFinish={localEditFinish} pRagInfo={pRagInfo}
                    apiRelativeUrls={apiRelativeUrls}/>
    </>
  )
}

export default MaterialManage
