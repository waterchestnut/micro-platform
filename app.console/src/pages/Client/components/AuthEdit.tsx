import React, {ForwardRefRenderFunction, useEffect, useImperativeHandle, useRef, useState} from 'react'
import {
  ModalForm,
  ProFormInstance, ProFormSelect,
  ProFormText,
} from '@ant-design/pro-components'
import {waitTime} from '@/utils/util'
import {errorMessage, successMessage} from '@/utils/msg'
import {addClientPriv} from '@/services/app/clientPriv'
import {getClientModuleList} from '@/services/app/clientModule'

export type EditProps = {
  onEditFinish?: (resData?: any) => Promise<void>;
  clientCode: string;
  apiRelativeUrls?: any;
};

export type EditAction = {
  show: (record?: any) => void;
  close: () => void;
}

const formItemLayout =
  {
    labelCol: {span: 4},
    wrapperCol: {span: 20},
  }

const inlineItemLayout = {
  labelCol: {span: 8},
  wrapperCol: {span: 16},
}

const Edit: ForwardRefRenderFunction<EditAction, EditProps> = (props, ref) => {
  const {onEditFinish, clientCode, apiRelativeUrls} = props
  const [isOpen, setIsOpen] = useState(false)
  const [privInfo, setPrivInfo] = useState<any>(null)
  const formRef = useRef<ProFormInstance>()
  const [moduleList, setModuleList] = useState<any[]>([])

  const loadModuleList = async () => {
    if (!clientCode) {
      setModuleList([])
      return
    }
    let data = await getClientModuleList(clientCode, apiRelativeUrls?.getClientModuleList)
    setModuleList(data || [])
  }

  useEffect(() => {
    loadModuleList()
  }, [clientCode])

  const handleOk = async () => {
    try {
      await formRef?.current?.validateFields()
    } catch (e) {
      console.error(e)
      return
    }
    let formData = formRef?.current?.getFieldsFormatValue?.(true)
    let ret
    let tip
    ret = await addClientPriv(clientCode, formData, apiRelativeUrls?.addClientPriv)
    tip = '添加权限'
    if (ret.code !== 0) {
      let msg = ret.msg || tip + '失败，请稍后再试'
      return errorMessage(msg)
    }

    if (onEditFinish) {
      await onEditFinish()
    }
    successMessage(tip + '成功')
    setIsOpen(false)
  }

  const handleCancel = () => {
    setIsOpen(false)
  }

  useImperativeHandle(ref, () => ({
    show: async (info: any) => {
      setPrivInfo(info || null)
      waitTime(200).then(() => {
        if (info) {
          formRef?.current?.setFieldsValue(info)
        } else {
          formRef?.current?.resetFields()
        }
      })
      setIsOpen(true)
    },
    close: () => {
      handleCancel()
    }
  }))

  return (
    <ModalForm
      title={(privInfo ? privInfo.viewer ? '查看' : '编辑' : '添加') + '权限'}
      open={isOpen}
      layout={'horizontal'}
      modalProps={
        {
          onCancel: handleCancel,
          centered: true,
          destroyOnClose: true
        }
      }
      onFinish={async () => {
        await handleOk()
      }}
      formRef={formRef}
      {...formItemLayout}
      grid={true}
      readonly={privInfo?.viewer}
      submitter={privInfo?.viewer ? false : undefined}
    >
      <ProFormText
        name='modulePrivCode'
        label='权限标识'
        rules={[
          {
            required: true,
            message: '请输入权限标识',
          },
        ]}
      />
      <ProFormText
        name='modulePrivName'
        label='权限名称'
        rules={[
          {
            required: true,
            message: '请输入权限名称',
          },
        ]}
      />
      <ProFormSelect
        name='moduleCode'
        label='所属模块'
        params={{clientCode}}
        request={async () => {
          return (moduleList || []).map((module: any) => ({label: module.moduleName, value: module.moduleCode}))
        }}
        rules={[
          {
            required: true,
            message: '请选择模块',
          },
        ]}
      />
    </ModalForm>
  )
}

export default React.forwardRef(Edit)
