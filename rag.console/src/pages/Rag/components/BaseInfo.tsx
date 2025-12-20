import React, {ForwardRefRenderFunction, useEffect, useImperativeHandle, useRef, useState} from 'react'
import {
  ProCard,
  ProForm, ProFormDigit,
  ProFormGroup,
  ProFormInstance,
  ProFormList, ProFormSelect, ProFormSwitch, ProFormText, ProFormTextArea
} from '@ant-design/pro-components'
import {formatUploadFile, isArray, waitTime} from '@/utils/util'
import {errorMessage, successMessage} from '@/utils/msg'
import {addRagInfo, updateRagInfo} from '@/services/rag/ragInfo'
import {Button, Col, Row, Space} from 'antd'
import StatusEnum from '@/enum/StatusEnum'

export type BaseInfoProps = {
  onEditFinish?: (resData?: any) => Promise<void>;
  onEditCancel?: () => void;
  pRagInfo?: any;
  apiRelativeUrls?: any;
  addHideRagCode?: boolean;
};

export type BaseInfoAction = {
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

const BaseInfo: ForwardRefRenderFunction<BaseInfoAction, BaseInfoProps> = (props, ref) => {
  const {onEditFinish, onEditCancel, pRagInfo, apiRelativeUrls, addHideRagCode} = props
  const [editing, setEditing] = useState(false)
  const [ragInfo, setRagInfo] = useState<any>(null)
  const formRef = useRef<ProFormInstance>()

  const resetForm = (info: any) => {
    waitTime(200).then(() => {
      if (info) {
        formRef?.current?.setFieldsValue(info)
      } else {
        formRef?.current?.resetFields()
      }
    })
  }

  useEffect(() => {
    setRagInfo(pRagInfo)
    resetForm(pRagInfo)
  }, [pRagInfo])

  const handleOk = async () => {
    try {
      await formRef?.current?.validateFields()
    } catch (e) {
      console.error(e)
      return
    }
    let formData = formRef?.current?.getFieldsFormatValue?.(true)
    //return console.log(formData)
    let ret
    let tip
    if (ragInfo) {
      ret = await updateRagInfo(formData, apiRelativeUrls?.updateRagInfo)
      tip = '修改知识库'
    } else {
      ret = await addRagInfo(formData, apiRelativeUrls?.addRagInfo)
      tip = '添加知识库'
    }
    if (ret.code !== 0) {
      let msg = ret.msg || tip + '失败，请稍后再试'
      return errorMessage(msg)
    }

    if (onEditFinish) {
      await onEditFinish()
    }
    successMessage(tip + '成功')
    setEditing(false)
  }

  const handleCancel = () => {
    setEditing(false)

    if (onEditCancel) {
      onEditCancel()
    }
  }

  useImperativeHandle(ref, () => ({
    show: async (info: any) => {
      setRagInfo(info || null)
      resetForm(info)
      setEditing(!info?.viewer)
    },
    close: () => {
      handleCancel()
    }
  }))

  return (
    <ProForm
      layout={'horizontal'}
      onFinish={async () => {
        await handleOk()
      }}
      formRef={formRef}
      {...formItemLayout}
      grid={true}
      labelWrap={true}
      readonly={ragInfo?.viewer || !editing}
      submitter={ragInfo?.viewer ? false : {
        render: (props, doms) => {
          return (
            <Row>
              <Col span={formItemLayout.wrapperCol.span} offset={formItemLayout.labelCol.span}>
                {
                  editing ? <Space>
                    <Button type='default' onClick={() => {
                      handleCancel()
                    }}>取消</Button>
                    <Button type='primary' onClick={() => {
                      handleOk()
                    }}>提交</Button>
                  </Space> : <Button type='default' onClick={() => {
                    setEditing(true)
                  }}>修改</Button>
                }
              </Col>
            </Row>
          )
        },
      }}
    >
      {
        !addHideRagCode || ragInfo?.ragCode ?
          <ProFormText
            name='ragCode'
            label='知识库标识'
            rules={[
              {
                required: true,
                message: '请输入知识库标识',
              },
            ]}
            readonly={ragInfo?.viewer || ragInfo?.ragCode}
          /> : null
      }
      <ProFormText
        name='title'
        label='知识库标题'
        rules={[
          {
            required: true,
            message: '请输入标题',
          },
        ]}
      />
      {
        ragInfo?.ragCode ?
          <ProFormSelect
            name='status'
            label='状态'
            readonly
            options={StatusEnum.toOptions()}
          /> : null
      }
      <ProFormTextArea
        name='description'
        label='知识库描述'
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
    </ProForm>
  )
}

export default React.forwardRef(BaseInfo)
