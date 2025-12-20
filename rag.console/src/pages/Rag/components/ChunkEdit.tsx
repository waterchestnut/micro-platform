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
import {addRagChunk, updateRagChunk} from '@/services/rag/ragChunk'
import StatusEnum from '@/enum/StatusEnum'
import {Button, Form, Input} from 'antd'

export type ChunkEditProps = {
  onEditFinish?: (resData?: any) => Promise<void>;
  pMaterialInfo?: any;
  apiRelativeUrls?: any;
};

export type ChunkEditAction = {
  show: (record?: any, segmentInfo?: any) => void;
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

const ChunkEdit: ForwardRefRenderFunction<ChunkEditAction, ChunkEditProps> = (props, ref) => {
  const {pMaterialInfo, apiRelativeUrls, onEditFinish} = props
  const [isOpen, setIsOpen] = useState(false)
  const [chunkInfo, setChunkInfo] = useState<any>(null)
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
    if (chunkInfo) {
      ret = await updateRagChunk({
        ...formData,
        ragCode: pMaterialInfo?.ragCode,
        ragMaterialCode: pMaterialInfo?.ragMaterialCode,
        ragSegmentCode: segmentInfo?.ragSegmentCode,
      }, apiRelativeUrls?.updateRagChunk)
      tip = '修改分句'
    } else {
      ret = await addRagChunk({
        ...formData,
        ragCode: pMaterialInfo?.ragCode,
        ragMaterialCode: pMaterialInfo?.ragMaterialCode,
        ragSegmentCode: segmentInfo?.ragSegmentCode,
      }, apiRelativeUrls?.addRagChunk)
      tip = '添加分句'
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
    show: async (info: any, pSegmentInfo: any) => {
      setChunkInfo(info || null)
      setSegmentInfo(pSegmentInfo || null)
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
      title={(chunkInfo ? chunkInfo.viewer ? '查看' : '编辑' : '新建') + '分句'}
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
      readonly={chunkInfo?.viewer}
      submitter={chunkInfo?.viewer ? false : undefined}
    >
      {
        chunkInfo?.ragChunkCode ?
          <ProFormText
            name='ragChunkCode'
            label='分句标识'
            readonly={true}
          /> : null
      }
      <ProFormText
        name='language'
        label='分句语言'
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
        label='分句内容'
      />
    </ModalForm>
  )
}

export default React.forwardRef(ChunkEdit)
