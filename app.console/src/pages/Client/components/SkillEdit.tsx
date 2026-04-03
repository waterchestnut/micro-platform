import React, {ForwardRefRenderFunction, useImperativeHandle, useRef, useState} from 'react'
import {
  ModalForm,
  ProFormInstance,
  ProFormText,
  ProFormTextArea,
  ProFormSelect,
} from '@ant-design/pro-components'
import {waitTime} from '@/utils/util'
import {errorMessage, successMessage} from '@/utils/msg'
import {addGrpcSkill, updateGrpcSkill} from '@/services/llm/grpcSkill'
import LLMChannelEnum from '@/enum/LLMChannelEnum'

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
  const [skillInfo, setSkillInfo] = useState<any>(null)
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
    if (skillInfo && !skillInfo.viewer) {
      ret = await updateGrpcSkill({...formData, skillCode: skillInfo.skillCode}, apiRelativeUrls?.updateGrpcSkill)
      tip = '修改技能'
    } else {
      ret = await addGrpcSkill({...formData, clientCode: pClientInfo.clientCode}, apiRelativeUrls?.addGrpcSkill)
      tip = '添加技能'
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
      setSkillInfo(info || null)
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
      title={(skillInfo ? skillInfo.viewer ? '查看' : '编辑' : '添加') + '技能'}
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
      readonly={skillInfo?.viewer}
      submitter={skillInfo?.viewer ? false : undefined}
    >
      <ProFormText
        name='skillCode'
        label='技能标识'
        rules={[
          {
            required: true,
            message: '请输入技能标识',
          },
        ]}
        disabled={!!skillInfo && !skillInfo.viewer}
      />
      <ProFormText
        name='skillName'
        label='技能名称'
        rules={[
          {
            required: true,
            message: '请输入技能名称',
          },
        ]}
      />
      <ProFormText
        name='grpcHost'
        label='远程主机地址'
        placeholder='如: localhost:50051'
        rules={[
          {
            required: true,
            message: '请输入远程主机地址',
          },
        ]}
      />
      <ProFormTextArea
        name='skillMD'
        label='技能描述'
        placeholder='SKILL.md格式的技能描述'
        fieldProps={{
          rows: 6,
        }}
        rules={[
          {
            required: true,
            message: '请输入技能描述',
          },
        ]}
      />
      <ProFormSelect
        name='channels'
        label='聊天频道'
        mode='multiple'
        valueEnum={LLMChannelEnum.toValueEnum()}
        fieldProps={{
          placeholder: '请选择聊天频道',
        }}
      />
      <ProFormTextArea
        name='note'
        label='备注'
      />
    </ModalForm>
  )
}

export default React.forwardRef(Edit)
