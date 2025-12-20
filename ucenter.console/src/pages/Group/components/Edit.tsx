import React, {ForwardRefRenderFunction, useImperativeHandle, useRef, useState} from 'react'
import {
  ModalForm,
  ProCard,
  ProFormDependency, ProFormDigit,
  ProFormFieldSet, ProFormGroup,
  ProFormInstance,
  ProFormList, ProFormSelect,
  ProFormText, ProFormTextArea
} from '@ant-design/pro-components'
import {waitTime} from '@/utils/util'
import {errorMessage, successMessage} from '@/utils/msg'
import {addGroup, updateGroup} from '@/services/ucenter/group'
import StatusEnum from '@/enum/StatusEnum'
import AuthTypeEnum from '@/enum/AuthTypeEnum'
import SchemaEnum from '@/enum/SchemaEnum'

export type EditProps = {
  onEditFinish?: (resData?: any) => Promise<void>;
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
  const {onEditFinish} = props
  const [isOpen, setIsOpen] = useState(false)
  const [groupInfo, setGroupInfo] = useState<any>(null)
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
    if (groupInfo) {
      ret = await updateGroup(formData)
      tip = '修改角色'
    } else {
      ret = await addGroup(formData)
      tip = '添加角色'
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
      setGroupInfo(info || null)
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
      title={(groupInfo ? groupInfo.viewer ? '查看' : '编辑' : '新建') + '角色'}
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
      readonly={groupInfo?.viewer}
      submitter={groupInfo?.viewer ? false : undefined}
    >
      <ProFormText
        name='groupCode'
        label='角色标识'
        rules={[
          {
            required: true,
            message: '请输入角色标识',
          },
        ]}
        readonly={groupInfo?.viewer || groupInfo?.groupCode}
      />
      <ProFormText
        name='groupName'
        label='角色名称'
        rules={[
          {
            required: true,
            message: '请输入角色名称',
          },
        ]}
      />
      <ProFormSelect
        name='status'
        label='状态'
        options={StatusEnum.toOptions()}
      />
      <ProFormSelect
        name='authType'
        label='授权类型'
        options={AuthTypeEnum.toOptions()}
      />
      <ProFormSelect
        name='schemaCodes'
        label='使用模式'
        fieldProps={{mode: 'multiple'}}
        options={SchemaEnum.toOptions()}
      />
      <ProFormTextArea
        name='description'
        label='备注'
      />
      <ProFormList
        name='tags'
        label='标签'
        creatorButtonProps={{
          creatorButtonText: '添加标签',
        }}
        copyIconProps={{tooltipText: '复制'}}
        deleteIconProps={{tooltipText: '删除'}}
        itemRender={({listDom, action}, {index}) => (
          <ProCard
            bordered
            style={{marginBlockEnd: 8}}
            extra={action}
            bodyStyle={{paddingBlockEnd: 0}}
          >
            {listDom}
          </ProCard>
        )}
        rowProps={
          {style: {margin: 0}}
        }
      >
        <ProFormGroup>
          <ProFormText
            name='key'
            label='标签名'
            rules={[
              {
                required: true,
                message: '请输入标签名',
              },
            ]}
            colProps={{span: 12}}
            {...inlineItemLayout}
          />
          <ProFormText
            name='value'
            label='标签值'
            rules={[
              {
                required: true,
                message: '请输入标签值',
              },
            ]}
            colProps={{span: 12}}
            {...inlineItemLayout}
          />
        </ProFormGroup>
      </ProFormList>
    </ModalForm>
  )
}

export default React.forwardRef(Edit)
