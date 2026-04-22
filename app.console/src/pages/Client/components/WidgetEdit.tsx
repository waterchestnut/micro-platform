import React, {ForwardRefRenderFunction, useImperativeHandle, useRef, useState} from 'react'
import {
  ModalForm,
  ProFormInstance,
  ProFormText,
  ProFormTextArea,
  ProFormSwitch,
  ProFormDigit,
  ProFormUploadButton,
} from '@ant-design/pro-components'
import {formatUploadFile, getDocHttpUrl, isArray, waitTime} from '@/utils/util'
import {errorMessage, successMessage} from '@/utils/msg'
import {addWidget, updateWidget} from '@/services/app/widget'
import {getAccessToken} from '@/utils/authority'
import {Button, Upload} from 'antd'

// @ts-ignore
const docBaseUrl = DOC_API_BASE

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

  const resetForm = (info: any) => {
    waitTime(200).then(() => {
      if (info) {
        info.logoUrl = isArray(info.logoUrl) ? info.logoUrl.map((_: any) => ({
          ..._,
          url: getDocHttpUrl(_.url)
        })) : info.logoUrl ? [{
          uid: '-1',
          status: 'done',
          url: getDocHttpUrl(info.logoUrl)
        }] : []
        formRef?.current?.setFieldsValue(info)
      } else {
        formRef?.current?.resetFields()
      }
    })
  }

  const handleOk = async () => {
    try {
      await formRef?.current?.validateFields()
    } catch (e) {
      console.error(e)
      return
    }
    let formData = formRef?.current?.getFieldsFormatValue?.(true)
    formData.logoUrl = formatUploadFile(formData.logoUrl).find(_ => _.status === 'done')?.url || ''
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
      resetForm(info)
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
      <ProFormUploadButton
        label='小组件图标'
        name='logoUrl'
        title='选择图片'
        max={1}
        fieldProps={{
          name: 'logo',
          listType: 'picture-card',
          accept: '.png, .jpg, .jpeg',
          beforeUpload: (file) => {
            const isJpgOrPng = file.type === 'image/jpeg' || file.type === 'image/png'
            if (!isJpgOrPng) {
              errorMessage('仅支持PNG、JPG格式的图片，且文件大小不超过300K。')
              return Upload.LIST_IGNORE
            }
            const isLt = file.size / 1024 < 300
            if (!isLt) {
              errorMessage('仅支持PNG、JPG格式的图片，且文件大小不超过300K。')
              return Upload.LIST_IGNORE
            }
            return new Promise((resolve) => {
              const reader = new FileReader()
              reader.onload = () => {
                const img = new Image()
                img.onload = () => {
                  if (img.width !== 256 || img.height !== 256) {
                    errorMessage('图片尺寸必须是256x256像素')
                    resolve(Upload.LIST_IGNORE)
                  } else {
                    resolve(true)
                  }
                }
                img.src = reader.result as string
              }
              reader.readAsDataURL(file)
            })
          },
          headers: {'param-accessToken': getAccessToken()},
        }}
        action={docBaseUrl + '/file/upload/simple'}
        extra='支持PNG、JPG格式，256x256像素，文件大小不超过300K。'
        onChange={({file, fileList}) => {
          if (file.response && file.response.code !== 0) {
            file.status = 'error'
            errorMessage('上传失败：' + (file.response.msg || '请稍后再试'))
            fileList.splice(fileList.findIndex(_ => _.uid === file.uid), 1)
          }
        }}
      />
      <ProFormText
        name='apiUrl'
        label='API地址'
        placeholder='获取小组件内容的接口地址'
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
