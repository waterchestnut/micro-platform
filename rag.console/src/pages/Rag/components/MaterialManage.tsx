import React, {createRef, useRef} from 'react'
import {ActionType, ProColumns} from '@ant-design/pro-components'
import ProTableWrapper from '@/components/ProTableWrapper'
import {deleteRagMaterial, getRagMaterialList} from '@/services/rag/ragMaterial'
import {history} from '@@/core/history'
import MaterialEdit, {MaterialEditAction} from '@/pages/Rag/components/MaterialEdit'
import {Button, Popconfirm} from 'antd'
import {errorMessage, successMessage} from '@/utils/msg'

export type MaterialManageProps = {
  pRagInfo?: any;
  apiRelativeUrls?: any;
  toDetail?: (ragCode: string, ragMaterialCode: string) => void;
};

const MaterialManage: React.FC<MaterialManageProps> = (props) => {
  const {pRagInfo, apiRelativeUrls, toDetail} = props
  const actionRef = useRef<ActionType>()
  const materialEditRef = createRef<MaterialEditAction>()

  const localEditFinish = async () => {
    actionRef.current?.reloadAndRest?.()
  }
  const columns: ProColumns[] = [
    {
      title: '材料标识',
      dataIndex: 'ragMaterialCode',
    },
    {
      title: '材料标题',
      dataIndex: 'resTitle',
    },
    {
      title: '备注',
      dataIndex: 'description',
      search: false
    },
    {
      title: '操作',
      dataIndex: 'option',
      valueType: 'option',
      width: 160,
      fixed: 'right',
      className: 'option-wrap',
      render: (_, record) => [
        <a
          key='detail'
          onClick={() => {
            if (toDetail) {
              toDetail(record.ragCode, record.ragMaterialCode)
            } else {
              history.push(`/rag/detail/${record.ragCode}/${record.ragMaterialCode}`)
            }
          }}
        >
          材料片段
        </a>,
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
          <a href='#'>删除</a>
        </Popconfirm>,
      ],
    },
  ]
  return (
    <>
      <ProTableWrapper
        columns={columns}
        /*headerTitle='知识库文档材料'*/
        rowKey='ragMaterialCode'
        actionRef={actionRef}
        pagination={{hideOnSinglePage: true, pageSize: 20}}
        request={async (paramsIn, sorter, filterIn) => {
          /*console.log(paramsIn, sorter, filterIn);*/
          let filter = {...paramsIn, ragCode: pRagInfo.ragCode}
          delete filter.current
          delete filter.pageSize
          let data = await getRagMaterialList(paramsIn.current, paramsIn.pageSize, filter, {}, apiRelativeUrls?.getRagMaterialList, pRagInfo.ragCode)
          return {
            data: data.rows,
            total: data.total,
            success: true
          }
        }}
        toolBarRender={() => [
          <Button type='primary' key='add' onClick={() => {
            materialEditRef?.current?.show()
          }}>
            上传材料
          </Button>,
        ]}
      />
      <MaterialEdit ref={materialEditRef} onEditFinish={localEditFinish} pRagInfo={pRagInfo}
                    apiRelativeUrls={apiRelativeUrls}/>
    </>
  )
}

export default MaterialManage
