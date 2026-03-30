import React, {useRef, useState} from 'react'
import {
  ProForm,
  ProFormCaptcha,
  ProFormText,
} from '@ant-design/pro-components'
import {Button, Card, Col, Row, Space, message} from 'antd'
import {LockOutlined, MailOutlined} from '@ant-design/icons'
import {updateLoginEmail} from '@/services/ucenter/user'
import {getEmailCode} from '@/services/ucenter/userAuth'
import {getCaptcha} from '@/services/ucenter/captcha'
import {errorMessage, successMessage} from '@/utils/msg'
import {uuid} from '@/utils/util'

export type EmailEditProps = {
  email?: string;
  onEditFinish?: () => void;
}

export type EmailEditAction = {
  show: () => void;
}

const EmailEdit: React.FC<EmailEditProps> = (props) => {
  const {email, onEditFinish} = props
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
      const res = await updateLoginEmail(values.newEmail, values.emailCode)
      if (res.code === 0) {
        successMessage('邮箱修改成功')
        setEditing(false)
        if (onEditFinish) {
          onEditFinish()
        }
      } else {
        errorMessage(res.msg || '邮箱修改失败')
      }
    } catch (e) {
      console.error(e)
    }
  }

  const getEmailCodeValue = async (email: string) => {
    const captcha = formRef.current?.getFieldValue('captcha')
    if (!email) {
      message.error('请输入新邮箱')
      return false
    }
    if (!captcha) {
      message.error('请输入图形验证码')
      return false
    }
    const res = await getEmailCode(email, captchaKey, captcha)
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
      title='邮箱'
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
          name='currentEmail'
          label='当前邮箱'
          readonly
          placeholder='-'
          initialValue={email}
        />
        {
          editing && (
            <>
              <ProFormText
                name='newEmail'
                label='新邮箱'
                placeholder='请输入新邮箱'
                fieldProps={{
                  prefix: <MailOutlined/>,
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
                name='emailCode'
                label='邮箱验证码'
                placeholder='请输入邮箱验证码'
                captchaTextRender={(timing, count) => {
                  if (timing) {
                    return `${count} 秒后重发`
                  }
                  return '获取验证码'
                }}
                onGetCaptcha={async (email) => {
                  await getEmailCodeValue(email)
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

export default EmailEdit
