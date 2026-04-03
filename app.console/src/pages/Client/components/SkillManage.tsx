import React, {createRef, useRef} from 'react'
import {ActionType, ProColumns} from '@ant-design/pro-components'
import {EditAction} from '@/pages/Client/components/SkillEdit'
import {Button, Popconfirm, Tag} from 'antd'
import {errorMessage, successMessage} from '@/utils/msg'
import {deleteGrpcSkill, enableGrpcSkill, disableGrpcSkill, getGrpcSkillList} from '@/services/llm/grpcSkill'
import ProTableWrapper from '@/components/ProTableWrapper'
import Edit from '@/pages/Client/components/SkillEdit'
import LLMChannelEnum from '@/enum/LLMChannelEnum'

export type SkillManageProps = {
  pClientInfo?: any;
  apiRelativeUrls?: any;
};

const SkillManage: React.FC<SkillManageProps> = (props) => {
  const {pClientInfo, apiRelativeUrls} = props
  const actionRef = useRef<ActionType>()
  const editRef = createRef<EditAction>()

  const localEditFinish = async () => {
    actionRef.current?.reloadAndRest?.()
  }

  const handleEnable = async (skillCode: string) => {
    let ret = await enableGrpcSkill(skillCode, apiRelativeUrls?.enableGrpcSkill)
    if (ret.code !== 0) {
      let msg = ret.msg || '启用失败，请稍后再试'
      return errorMessage(msg)
    }
    successMessage('启用成功')
    actionRef?.current?.reloadAndRest?.()
  }

  const handleDisable = async (skillCode: string) => {
    let ret = await disableGrpcSkill(skillCode, apiRelativeUrls?.disableGrpcSkill)
    if (ret.code !== 0) {
      let msg = ret.msg || '禁用失败，请稍后再试'
      return errorMessage(msg)
    }
    successMessage('禁用成功')
    actionRef?.current?.reloadAndRest?.()
  }

  const columns: ProColumns[] = [
    {
      title: '技能标识',
      dataIndex: 'skillCode',
    },
    {
      title: '技能名称',
      dataIndex: 'skillName',
    },
    {
      title: '远程主机地址',
      dataIndex: 'grpcHost',
      ellipsis: true,
    },
    {
      title: '聊天频道',
      dataIndex: 'channels',
      render: (val) => {
        if (!val || !Array.isArray(val)) return '-'
        return val.map((item: string) => <Tag key={item}>{LLMChannelEnum.toLabel(item) || item}</Tag>)
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      render: (val) => {
        return val === 0 ? <Tag color='success'>已启用</Tag> : <Tag color='default'>已禁用</Tag>
      },
    },
    {
      title: '操作',
      dataIndex: 'option',
      valueType: 'option',
      width: 200,
      fixed: 'right',
      className: 'option-wrap',
      render: (_, record) => [
        <a
          key='view'
          onClick={() => {
            editRef?.current?.show({...record, viewer: true})
          }}
        >
          查看
        </a>,
        <a
          key='edit'
          onClick={() => {
            editRef?.current?.show(record)
          }}
        >
          修改
        </a>,
        record.status === 0 ? <Popconfirm
          title='确定要禁用该技能吗？'
          onConfirm={async () => {
            await handleDisable(record.skillCode)
          }}
          okText='确定'
          cancelText='取消'
          key='disable'
        >
          <a href='#'>禁用</a>
        </Popconfirm> : <a
          key='enable'
          onClick={async () => {
            await handleEnable(record.skillCode)
          }}
        >
          启用
        </a>,
        <Popconfirm
          title='确定要删除该技能吗？'
          onConfirm={async () => {
            let ret = await deleteGrpcSkill(record.skillCode, apiRelativeUrls?.deleteGrpcSkill)
            if (ret.code !== 0) {
              let msg = ret.msg || '删除失败，请稍后再试'
              return errorMessage(msg)
            }
            successMessage('删除技能成功')
            actionRef?.current?.reloadAndRest?.()
          }}
          okText='确定'
          cancelText='取消'
          key='delete'
        >
          <a href='#'>删除</a>
        </Popconfirm>
      ],
    },
  ]
  return (
    <>
      <ProTableWrapper
        columns={columns}
        rowKey='skillCode'
        actionRef={actionRef}
        search={false}
        pagination={{hideOnSinglePage: true, pageSize: 2000}}
        request={async (paramsIn, sorter, filterIn) => {
          let filter = {
            clientCode: pClientInfo.clientCode,
            ...filterIn
          }
          let data = await getGrpcSkillList(1, 2000, filter, {}, apiRelativeUrls?.getGrpcSkillList)
          return {
            data: data?.rows || [],
            total: data?.total || 0,
            success: true
          }
        }}
        toolBarRender={() => [
          <Button type='primary' key='add' onClick={() => {
            editRef?.current?.show()
          }}>
            添加技能
          </Button>,
        ]}
      />
      <Edit ref={editRef} onEditFinish={localEditFinish} pClientInfo={pClientInfo} apiRelativeUrls={apiRelativeUrls}/>
    </>
  )
}

export default SkillManage
