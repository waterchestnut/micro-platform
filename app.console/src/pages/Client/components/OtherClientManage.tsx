import React, {createRef, useEffect, useRef, useState} from 'react'
import OtherClientPrivs, {OtherClientPrivsAction} from '@/pages/Client/components/OtherClientPrivs'
import {ProCard, ProColumns, ProForm, ProFormInstance, ProFormText} from '@ant-design/pro-components'
import ProTableWrapper from '@/components/ProTableWrapper'
import {getOtherClientPrivsList, saveOtherClientPrivs} from '@/services/app/clientPriv'
import {errorMessage, successMessage} from '@/utils/msg'
import {getUcenterClient, updateClient} from '@/services/app/client'
import {Popconfirm} from 'antd'

export type OtherClientManageProps = {
  pClientInfo?: any;
  onEditFinish?: (resData?: any) => Promise<void>;
  apiRelativeUrls?: any;
};

const OtherClientManage: React.FC<OtherClientManageProps> = (props) => {
  const {pClientInfo, onEditFinish, apiRelativeUrls} = props
  const [otherClients, setOtherClients] = useState<any>([])
  const formRef = useRef<ProFormInstance>()
  const privsRef = createRef<OtherClientPrivsAction>()

  const loadOtherClients = async () => {
    if (!pClientInfo?.toClients?.length) {
      setOtherClients([])
      return
    }
    let rows = await getOtherClientPrivsList(pClientInfo.clientCode, pClientInfo.toClients, apiRelativeUrls?.getOtherClientPrivsList)
    let list = pClientInfo.toClients.map((clientCode: string) => ({clientCode, ...rows.find((_: any) => _.clientCode === clientCode)}))
    setOtherClients(list)
  }

  useEffect(() => {
    loadOtherClients()
  }, [pClientInfo])

  const joinOtherClientList = async (formData: any) => {
    let clientCode = formData.clientCode
    if (!clientCode) {
      return errorMessage('请输入应用标识')
    }
    if (clientCode === pClientInfo.clientCode) {
      return errorMessage('无需给自己应用赋权')
    }
    if (pClientInfo?.toClients?.includes(clientCode)) {
      return errorMessage('该应用已在赋权列表，无需重复加入')
    }

    let ret = await getUcenterClient(clientCode, apiRelativeUrls?.getUcenterClient)
    if (!ret?.clientCode) {
      return errorMessage('该应用不存在')
    }
    let toClients = pClientInfo?.toClients || []
    toClients.push(clientCode)
    ret = await updateClient({clientCode: pClientInfo.clientCode, toClients}, apiRelativeUrls?.updateClient)
    if (ret.code !== 0) {
      let msg = ret.msg || '加入失败，请稍后再试'
      return errorMessage(msg)
    }

    successMessage('加入成功')
    if (onEditFinish) {
      await onEditFinish()
    }
  }

  const removeOtherClientList = async (clientCode: string) => {
    let ret = await saveOtherClientPrivs(pClientInfo.clientCode, clientCode, [], apiRelativeUrls?.saveOtherClientPrivs)
    if (ret.code !== 0) {
      let msg = ret.msg || '移除失败，请稍后再试'
      return errorMessage(msg)
    }
    let toClients = (pClientInfo?.toClients || []).filter((code: string) => code !== clientCode)
    ret = await updateClient({clientCode: pClientInfo.clientCode, toClients}, apiRelativeUrls?.updateClient)
    if (ret.code !== 0) {
      let msg = ret.msg || '移除失败，请稍后再试'
      return errorMessage(msg)
    }

    successMessage('移除成功')
    if (onEditFinish) {
      await onEditFinish()
    }
  }

  const columns: ProColumns[] = [
    {
      title: '应用标识',
      dataIndex: 'clientCode',
    },
    {
      title: '应用名称',
      dataIndex: 'clientName',
    },
    {
      title: '备注',
      dataIndex: 'description',
    },
    {
      title: '操作',
      dataIndex: 'option',
      valueType: 'option',
      width: 240,
      fixed: 'right',
      className: 'option-wrap',
      render: (_, record) => [
        record.clientName ? <a
          key='privs'
          onClick={() => {
            privsRef?.current?.show({...record})
          }}
        >
          权限分配
        </a> : <span key='not'>该应用已下架，建议移除</span>,
        <Popconfirm
          key='delete'
          title='移除后，给该应用分配的权限将被清空，确定要移除该应用吗？'
          onConfirm={async () => {
            removeOtherClientList(record.clientCode)
          }}
          okText='确定'
          cancelText='取消'
        >
          <a href='#'>
            移除
          </a>
        </Popconfirm>,
      ],
    },
  ]

  return (
    <>
      <ProCard
        style={{marginBottom: '16px'}}
      >
        <ProForm
          layout={'inline'}
          formRef={formRef}
          submitter={{
            searchConfig: {
              resetText: '重置',
              submitText: '加入赋权列表',
            },
          }}
          onFinish={joinOtherClientList}
          style={{justifyContent: 'flex-end'}}
        >
          <ProFormText
            label='应用标识'
            name='clientCode'
          />
        </ProForm>
      </ProCard>
      <ProTableWrapper
        columns={columns}
        headerTitle='其他应用赋权列表'
        rowKey='clientCode'
        search={false}
        pagination={{hideOnSinglePage: true, pageSize: 2000}}
        dataSource={otherClients}
        options={false}
      />
      <OtherClientPrivs ref={privsRef} onSaveFinish={async (resData) => {
        if (onEditFinish) {
          await onEditFinish(resData)
        }
      }} clientCode={pClientInfo.clientCode} apiRelativeUrls={apiRelativeUrls}/>
    </>
  )
}

export default OtherClientManage
