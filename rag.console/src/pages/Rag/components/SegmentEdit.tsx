import React, {ForwardRefRenderFunction, useImperativeHandle, useRef, useState} from 'react'
import {
  ModalForm,
  ProCard, ProFormDigit,
  ProFormGroup,
  ProFormInstance,
  ProFormList, ProFormSelect,
  ProFormText, ProFormTextArea
} from '@ant-design/pro-components'
import {uuidV4, waitTime} from '@/utils/util'
import {errorMessage, successMessage} from '@/utils/msg'
import {addRagSegment, updateRagSegment} from '@/services/rag/ragSegment'
import StatusEnum from '@/enum/StatusEnum'
import {Button, Form, Input} from 'antd'

export type SegmentEditProps = {
  onEditFinish?: (resData?: any) => Promise<void>;
  pMaterialInfo?: any;
  apiRelativeUrls?: any;
};

export type SegmentEditAction = {
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

const SegmentEdit: ForwardRefRenderFunction<SegmentEditAction, SegmentEditProps> = (props, ref) => {
  const {pMaterialInfo, apiRelativeUrls, onEditFinish} = props
  const [isOpen, setIsOpen] = useState(false)
  const [segmentInfo, setSegmentInfo] = useState<any>(null)
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
    if (segmentInfo) {
      ret = await updateRagSegment({
        ...formData,
        ragCode: pMaterialInfo?.ragCode,
        ragMaterialCode: pMaterialInfo?.ragMaterialCode
      }, apiRelativeUrls?.updateRagSegment)
      tip = '修改分段'
    } else {
      ret = await addRagSegment({
        ...formData,
        ragCode: pMaterialInfo?.ragCode,
        ragMaterialCode: pMaterialInfo?.ragMaterialCode
      }, apiRelativeUrls?.addRagSegment)
      tip = '添加分段'
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
      setSegmentInfo(info || null)
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
      title={(segmentInfo ? segmentInfo.viewer ? '查看' : '编辑' : '新建') + '分段'}
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
      readonly={segmentInfo?.viewer}
      submitter={segmentInfo?.viewer ? false : undefined}
    >
      {
        segmentInfo?.ragSegmentCode ?
          <ProFormText
            name='ragSegmentCode'
            label='分段标识'
            readonly={true}
          /> : null
      }
      <ProFormText
        name='language'
        label='分段语言'
        rules={[
          {
            required: true,
            message: '请输入语言',
          },
        ]}
      />
      <ProFormTextArea
        name='content'
        rules={[
          {
            required: true,
            message: '请输入文本内容',
          },
        ]}
        label='分段内容'
      />
    </ModalForm>
  )
}

export default React.forwardRef(SegmentEdit)
