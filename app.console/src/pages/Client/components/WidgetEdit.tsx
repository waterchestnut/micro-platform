import React, {ForwardRefRenderFunction, useImperativeHandle, useRef, useState} from 'react'
import {
  ModalForm,
  ProFormInstance,
  ProFormText,
  ProFormTextArea,
  ProFormSwitch,
  ProFormDigit,
} from '@ant-design/pro-components'
import {waitTime} from '@/utils/util'
import {errorMessage, successMessage} from '@/utils/msg'
import {addWidget, updateWidget} from '@/services/app/widget'

export type EditProps = {
  onEditFinish?: (resData?: any) => Promise<void>;
  pClientInfo?: any;
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

const Edit: ForwardRefRenderFunction<EditAction, EditProps> = (props, ref) => {
  const {onEditFinish, pClientInfo, apiRelativeUrls} = props
  const [isOpen, setIsOpen] = useState(false)
  const [widgetInfo, setWidgetInfo] = useState<any>(null)
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
    if (widgetInfo && !widgetInfo.viewer) {
      ret = await updateWidget({...formData, widgetCode: widgetInfo.widgetCode}, apiRelativeUrls?.updateWidget)
      tip = '修改小组件'
    } else {
      ret = await addWidget({...formData, clientCode: pClientInfo.clientCode}, apiRelativeUrls?.addWidget)
      tip = '添加小组件'
    }
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
      setWidgetInfo(info || null)
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
      title={(widgetInfo ? widgetInfo.viewer ? '查看' : '编辑' : '添加') + '小组件'}
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
      readonly={widgetInfo?.viewer}
      submitter={widgetInfo?.viewer ? false : undefined}
    >
      <ProFormText
        name='widgetCode'
        label='小组件标识'
        rules={[
          {
            required: true,
            message: '请输入小组件标识',
          },
        ]}
        disabled={!!widgetInfo && !widgetInfo.viewer}
      />
      <ProFormText
        name='widgetName'
        label='小组件名称'
        rules={[
          {
            required: true,
            message: '请输入小组件名称',
          },
        ]}
      />
      <ProFormText
        name='logoUrl'
        label='小组件图标'
        placeholder='图标URL地址'
      />
      <ProFormText
        name='apiUrl'
        label='API地址'
        placeholder='获取小组件内容的接口地址'
        rules={[
          {
            required: true,
            message: '请输入API地址',
          },
        ]}
      />
      <ProFormText
        name='miniApiUrl'
        label='小程序API地址'
        placeholder='小程序使用的代理后的API地址（相对地址）'
      />
      <ProFormTextArea
        name='description'
        label='小组件描述'
      />
      <ProFormDigit
        name='order'
        label='排序'
        initialValue={0}
      />
      <ProFormSwitch
        name='default2Home'
        label='默认展示到首页'
        tooltip='开启后，小组件将默认展示到用户首页'
        initialValue={false}
      />
    </ModalForm>
  )
}

export default React.forwardRef(Edit)