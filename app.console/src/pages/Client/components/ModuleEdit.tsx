import React, {ForwardRefRenderFunction, useImperativeHandle, useRef, useState} from 'react'
import {
  ModalForm,
  ProFormInstance,
  ProFormText,
} from '@ant-design/pro-components'
import {waitTime} from '@/utils/util'
import {errorMessage, successMessage} from '@/utils/msg'
import {addClientModule} from '@/services/app/clientModule'

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
  const [moduleInfo, setModuleInfo] = useState<any>(null)
  const formRef = useRef<ProFormInstance>()

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
    ret = await addClientModule(clientCode, formData, apiRelativeUrls?.addClientModule)
    tip = '添加模块'
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
      setModuleInfo(info || null)
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
      title={(moduleInfo ? moduleInfo.viewer ? '查看' : '编辑' : '添加') + '模块'}
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
      readonly={moduleInfo?.viewer}
      submitter={moduleInfo?.viewer ? false : undefined}
    >
      <ProFormText
        name='moduleCode'
        label='模块标识'
        rules={[
          {
            required: true,
            message: '请输入模块标识',
          },
        ]}
      />
      <ProFormText
        name='moduleName'
        label='模块名称'
        rules={[
          {
            required: true,
            message: '请输入模块名称',
          },
        ]}
      />
    </ModalForm>
  )
}

export default React.forwardRef(Edit)
