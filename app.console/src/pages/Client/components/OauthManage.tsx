import React, {useEffect, useRef, useState} from 'react'
import {ProCard, ProForm, ProFormInstance, ProFormList, ProFormText} from '@ant-design/pro-components'
import {Button, Col, Row, Space, Form, Input} from 'antd'
import {getUcenterClient, saveUcenterClient} from '@/services/app/client'
import {errorMessage, successMessage} from '@/utils/msg'
import {uuidV4, waitTime} from '@/utils/util'
import {domainPattern} from '@/utils/validator'

export type OauthManageProps = {
  pClientInfo?: any;
  apiRelativeUrls?: any;
};

const formItemLayout =
  {
    labelCol: {span: 4},
    wrapperCol: {span: 20},
  }

const inlineItemLayout = {
  labelCol: {span: 8},
  wrapperCol: {span: 16},
}

const OauthManage: React.FC<OauthManageProps> = (props) => {
  const {pClientInfo, apiRelativeUrls} = props
  const [editing, setEditing] = useState(false)
  const [ucenterClientInfo, setUcenterClientInfo] = useState<any>(null)
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

  const initUcenterClientInfo = async () => {
    if (pClientInfo?.clientCode) {
      let info = await getUcenterClient(pClientInfo.clientCode, apiRelativeUrls?.getUcenterClient)
      setUcenterClientInfo(info)
      resetForm(info)
    } else {
      resetForm(null)
    }
  }

  useEffect(() => {
    initUcenterClientInfo()
  }, [pClientInfo])

  const handleOk = async () => {
    try {
      await formRef?.current?.validateFields()
    } catch (e) {
      console.error(e)
      return
    }
    let formData = formRef?.current?.getFieldsFormatValue?.(true)
    let ret = await saveUcenterClient(formData, apiRelativeUrls?.saveUcenterClient)
    if (ret.code !== 0) {
      let msg = ret.msg || '提交失败，请稍后再试'
      return errorMessage(msg)
    }

    successMessage('提交成功')
    setEditing(false)
    initUcenterClientInfo()
  }

  return (
    <ProCard>
      <ProForm
        layout={'horizontal'}
        formRef={formRef}
        {...formItemLayout}
        grid={true}
        readonly={!editing}
        submitter={{
          render: (props, doms) => {
            return (
              <Row>
                <Col span={formItemLayout.wrapperCol.span} offset={formItemLayout.labelCol.span}>
                  {
                    editing ? <Space>
                      <Button type='default' onClick={() => {
                        setEditing(false)
                        resetForm(ucenterClientInfo)
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
        <ProFormList
          name='retUrls'
          label='回调域名'
          creatorRecord={() => {
            return String('')
          }}
          initialValue={['']}
          style={{marginBottom: 0}}
          creatorButtonProps={{
            creatorButtonText: '添加回调域名',
            type: 'link',
            style: {width: 'unset'},
          }}
          copyIconProps={false}
          deleteIconProps={{tooltipText: '删除'}}
          itemRender={({listDom, action}) => (
            <div
              style={{
                display: 'inline-flex',
                marginInlineEnd: 24,
              }}
            >
              {listDom}
              {action}
            </div>
          )}
          tooltip='不带http或https'
        >
          {(field, idx) => {
            return (
              <Form.Item
                {...field}
                label={idx + 1}
                rules={[
                  {
                    required: true,
                    message: '请输入回调域名',
                  },
                  {pattern: domainPattern, message: '请输入正确的回调域名'},
                  ({getFieldValue}) => ({
                    validator(_, value) {
                      if (!value || !value.length) {
                        return Promise.resolve()
                      }
                      let list = getFieldValue('retUrls')
                      let count = list?.filter((v: string) => v === value)?.length
                      if (count > 1) {
                        return Promise.reject(new Error('请勿重复输入'))
                      }
                      return Promise.resolve()
                    }
                  })
                ]}
              >
                {
                  !editing ?
                    <span>{ucenterClientInfo?.retUrls?.[idx] || '-'}</span> :
                    <Input/>
                }
              </Form.Item>
            )
          }
          }
        </ProFormList>
        <ProFormText
          name='clientSecret'
          label='接口秘钥'
          rules={[
            {
              required: true,
              message: '请生成秘钥',
            },
          ]}
          disabled={true}
          fieldProps={{
            suffix: !editing ? null : <Button size='small' type='link' onClick={() => {
              formRef?.current?.setFieldsValue({clientSecret: uuidV4()})
            }}>生成秘钥</Button>
          }}
        />
      </ProForm>
    </ProCard>
  )
}

export default OauthManage
