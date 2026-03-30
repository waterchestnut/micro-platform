import React, {useRef, useState} from 'react'
import {
  ProForm,
  ProFormCaptcha,
  ProFormText,
} from '@ant-design/pro-components'
import {Button, Card, Col, Row, Space, message} from 'antd'
import {LockOutlined, MobileOutlined} from '@ant-design/icons'
import {updateLoginMobile} from '@/services/ucenter/user'
import {getSmsCode} from '@/services/ucenter/userAuth'
import {getCaptcha} from '@/services/ucenter/captcha'
import {errorMessage, successMessage} from '@/utils/msg'
import {uuid} from '@/utils/util'

export type MobileEditProps = {
  mobile?: string;
  onEditFinish?: () => void;
}

export type MobileEditAction = {
  show: () => void;
}

const MobileEdit: React.FC<MobileEditProps> = (props) => {
  const {mobile, onEditFinish} = props
  const [editing, setEditing] = useState(false)
  const [captchaKey, setCaptchaKey] = useState('')
  const [captchaHtml, setCaptchaHtml] = useState('')
  const formRef = useRef<any>()

  const refreshCaptcha = async () => {
    const res = await getCaptcha(captchaKey)
    if (res.code === 0) {
      setCaptchaKey(res.data.key)
      setCaptchaHtml(res.data.image)
    }
  }

  const handleCancel = () => {
    setEditing(false)
    refreshCaptcha()
  }

  const handleSave = async () => {
    try {
      const values = formRef.current?.getFieldsFormatValue?.()
      const res = await updateLoginMobile(values.newMobile, values.smsCode)
      if (res.code === 0) {
        successMessage('手机号修改成功')
        setEditing(false)
        if (onEditFinish) {
          onEditFinish()
        }
      } else {
        errorMessage(res.msg || '手机号修改失败')
      }
    } catch (e) {
      console.error(e)
    }
  }

  const getSmsCodeValue = async (mobile: string) => {
    const captcha = formRef.current?.getFieldValue('captcha')
    if (!mobile) {
      message.error('请输入新手机号')
      return false
    }
    if (!captcha) {
      message.error('请输入图形验证码')
      return false
    }
    const res = await getSmsCode(mobile, captchaKey, captcha)
    if (res.code === 0) {
      message.success('验证码已发送')
      return true
    } else {
      message.error(res.msg || '获取验证码失败')
      refreshCaptcha()
      return false
    }
  }

  return (
    <Card
      title='手机号'
      style={{marginBottom: 16}}
      extra={
        !editing && <a onClick={() => {
          setEditing(true)
          refreshCaptcha()
        }}>修改</a>
      }
    >
      <ProForm
        formRef={formRef}
        submitter={false}
        layout='horizontal'
        labelCol={{span: 4}}
        wrapperCol={{span: 12}}
        readonly={!editing}
      >
        <ProFormText
          name='currentMobile'
          label='当前手机号'
          readonly
          placeholder='-'
          initialValue={mobile}
        />
        {
          editing && (
            <>
              <ProFormText
                name='newMobile'
                label='新手机号'
                placeholder='请输入新手机号'
                fieldProps={{
                  prefix: <MobileOutlined/>,
                }}
              />
              <ProFormText
                name='captcha'
                label='图形验证码'
                placeholder='请输入图形验证码'
                fieldProps={{
                  prefix: <LockOutlined/>,
                }}
                addonAfter={
                  <div
                    dangerouslySetInnerHTML={{__html: captchaHtml}}
                    onClick={refreshCaptcha}
                    style={{cursor: 'pointer', width: '100px', margin: '-15px -15px -15px 0'}}
                  />
                }
              />
              <ProFormCaptcha
                name='smsCode'
                label='手机验证码'
                placeholder='请输入手机验证码'
                captchaTextRender={(timing, count) => {
                  if (timing) {
                    return `${count} 秒后重发`
                  }
                  return '获取验证码'
                }}
                onGetCaptcha={async (mobile) => {
                  await getSmsCodeValue(mobile)
                }}
              />
              <Row>
                <Col span={12} offset={4}>
                  <Space>
                    <Button type='default' onClick={handleCancel}>取消</Button>
                    <Button type='primary' onClick={handleSave}>保存</Button>
                  </Space>
                </Col>
              </Row>
            </>
          )
        }
      </ProForm>
    </Card>
  )
}

export default MobileEdit
