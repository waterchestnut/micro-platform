// @ts-ignore
/* eslint-disable */
import {Footer} from '@/components'
import {phoneRegister, phoneRegisterVerify, emailRegister, emailRegisterVerify} from '@/services/ucenter/userAuth'
import {
  LockOutlined, MailOutlined,
  MobileOutlined, SafetyOutlined, UserOutlined,
} from '@ant-design/icons'
import {
  LoginForm,
  ProFormCaptcha,
  ProFormText,
} from '@ant-design/pro-components'
import {FormattedMessage, history, useIntl, Helmet} from '@umijs/max'
import {Alert, message, Tabs, theme, Form} from 'antd'
import Settings from '../../../../config/defaultSettings'
import React, {useEffect, useState} from 'react'
import {createStyles} from 'antd-style'
import {emailPattern, mobilePattern, checkPasswordComplexity} from '@/utils/validator'
import {getCaptcha} from '@/services/ucenter/captcha'
import {errorMessage, successMessage} from '@/utils/msg'

interface RegisterResult {
  status?: string;
  type?: string;
  msg?: string;
}

const useStyles = createStyles(({token}) => {
  return {
    container: {
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      overflow: 'auto',
      background: 'rgba(245, 245, 245, 0.6)',
    },
    captcha: {
      width: '100px',
      cursor: 'pointer',
      margin: '-15px -15px -15px 0',
      '& svg': {
        width: '100px',
        height: '40px'
      }
    }
  }
})

const RegisterMessage: React.FC<{
  content: string;
}> = ({content}) => {
  return (
    <Alert
      style={{
        marginBottom: 24,
      }}
      message={content}
      type='error'
      showIcon
    />
  )
}

const Register: React.FC = () => {
  const [registerState, setRegisterState] = useState<RegisterResult>({})
  const [type, setType] = useState<string>('mobile')
  const {styles} = useStyles()
  const intl = useIntl()
  const [captchaKey, setCaptchaKey] = useState('')
  const [captchaHtml, setCaptchaHtml] = useState('')
  const {token} = theme.useToken()
  const [form] = Form.useForm()

  useEffect(() => {
    refreshCaptcha()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refreshCaptcha = async () => {
    const res = await getCaptcha(captchaKey)
    if (res.code === 0) {
      setCaptchaKey(res.data.key)
      setCaptchaHtml(res.data.image)
    } else {
      errorMessage(res.msg || `刷新验证码出错`)
    }
  }

  const handleSubmit = async (values: any) => {
    try {
      // 注册
      let res
      if (type === 'mobile') {
        res = await phoneRegister(values.mobile, values.smsCode, values.pwd, values.realName)
      } else if (type === 'email') {
        res = await emailRegister(values.email, values.emailCode, values.pwd, values.realName)
      }

      if (res?.code === 0) {
        successMessage(intl.formatMessage({id:'pages.register.success',defaultMessage:'注册成功！请登录'}))
        // 跳转到登录页
        setTimeout(() => {
          history.replace(`/user/login${history.location.search}`)
        }, 1500)
        return
      }
      // 如果失败去设置错误信息
      setRegisterState({status: 'error', type, msg: res?.msg || intl.formatMessage({id:'pages.register.failed',defaultMessage:'注册失败'})})
      refreshCaptcha()
    } catch (error) {
      console.log(error)
      errorMessage(intl.formatMessage({id:'pages.register.retry',defaultMessage:'注册失败，请重试！'}))
      refreshCaptcha()
    }
  }

  const {status, type: registerType, msg} = registerState

  return (
    <div className={styles.container}>
      <Helmet>
        <title>
          {intl.formatMessage({
            id: 'menu.register',
            defaultMessage: '注册页',
          })}
          - {Settings.title}
        </title>
      </Helmet>
      <div
        style={{
          flex: '1',
          padding: '32px 0',
          justifyContent: 'center',
          alignItems: 'center',
          flexDirection: 'column',
          display: 'flex'
        }}
      >
        <div
          style={{
            minWidth: 480,
            background: 'rgba(255,255,255,0.6)',
            height: 'auto',
            borderRadius: 8
          }}
        >
          <LoginForm
            form={form}
            name='registerForm'
            containerStyle={
              {
                borderRadius: 8,
              }
            }
            contentStyle={{
              minWidth: 380,
              maxWidth: '75vw',
            }}
            logo={<img alt='logo' src='/logo.svg'/>}
            title={intl.formatMessage({id:'pages.register.userRegister',defaultMessage:'用户注册'})}
            subTitle={intl.formatMessage({id: 'pages.layouts.userLayout.title'})}
            submitter={{
              searchConfig: {
                submitText: intl.formatMessage({id:'pages.register.submit',defaultMessage:'注册'})
              }
            }}
            onFinish={async (values) => {
              await handleSubmit(values)
            }}
          >
            <Tabs
              activeKey={type}
              onChange={setType}
              centered
              items={[
                {
                  key: 'mobile',
                  label: intl.formatMessage({id:'pages.register.phoneTab',defaultMessage:'手机号注册'}),
                },
                {
                  key: 'email',
                  label: intl.formatMessage({id:'pages.register.emailTab',defaultMessage:'邮箱注册'}),
                },
              ]}
            />

            {status === 'error' && msg && (
              <RegisterMessage
                content={msg}
              />
            )}

            {type === 'mobile' && (
              <>
                <ProFormText
                  fieldProps={{
                    size: 'large',
                    prefix: <MobileOutlined/>,
                  }}
                  name='mobile'
                  placeholder={intl.formatMessage({id:'pages.login.phoneNumber.ph',defaultMessage:'手机号'})}
                  rules={[
                    {
                      required: true,
                      message: intl.formatMessage({id:'pages.login.phoneNumber.required2',defaultMessage:'请输入手机号！'}),
                    },
                    {
                      pattern: mobilePattern,
                      message: intl.formatMessage({id:'pages.login.phoneNumber.invalid2',defaultMessage:'手机号格式错误！'}),
                    },
                  ]}
                />
                <ProFormText
                  name='captcha'
                  fieldProps={{
                    size: 'large',
                    prefix: <SafetyOutlined/>,
                    suffix: <div className={styles.captcha} title={intl.formatMessage({id:'pages.login.captcha.refresh',defaultMessage:'点击刷新验证码'})} onClick={refreshCaptcha}
                                 dangerouslySetInnerHTML={{__html: captchaHtml}}/>
                  }}
                  placeholder={intl.formatMessage({id:'pages.login.imageCaptcha.placeholder',defaultMessage:'图形码'})}
                  rules={[
                    {
                      required: true,
                      message: intl.formatMessage({id:'pages.login.imageCaptcha.required',defaultMessage:'请输入图形码!'}),
                    },
                  ]}
                />
                <ProFormCaptcha
                  fieldProps={{
                    size: 'large',
                    prefix: <LockOutlined/>,
                  }}
                  captchaProps={{
                    size: 'large',
                  }}
                  placeholder={intl.formatMessage({id:'pages.smsCode.ph',defaultMessage:'短信验证码'})}
                  captchaTextRender={(timing, count) => {
                    if (timing) {
                      return `${count} 秒后重发`
                    }
                    return intl.formatMessage({id:'pages.login.getCode',defaultMessage:'获取验证码'})
                  }}
                  name='smsCode'
                  rules={[
                    {
                      required: true,
                      message: intl.formatMessage({id:'pages.login.captcha.req',defaultMessage:'请输入验证码！'}),
                    },
                  ]}
                  onGetCaptcha={async () => {
                    try {
                      await form.validateFields(['mobile', 'captcha'])
                      const mobile = form.getFieldValue('mobile')
                      const captcha = form.getFieldValue('captcha')
                      const currentCaptchaKey = captchaKey
                      if (!mobile || !captcha || !currentCaptchaKey) {
                        if (!currentCaptchaKey) {
                          message.error(intl.formatMessage({id:'pages.login.captchaFirst',defaultMessage:'请先获取图形验证码'}))
                          refreshCaptcha()
                          throw new Error(intl.formatMessage({id:'pages.login.captchaFirst',defaultMessage:'请先获取图形验证码'}))
                        } else {
                          message.error(intl.formatMessage({id:'pages.login.mobileAndCaptcha',defaultMessage:'请填写手机号和图形验证码'}))
                          throw new Error(intl.formatMessage({id:'pages.login.mobileAndCaptcha',defaultMessage:'请填写手机号和图形验证码'}))
                        }
                      }

                      const res = await phoneRegisterVerify(mobile, currentCaptchaKey, captcha)
                      if (res.code === 0) {
                        message.success(intl.formatMessage({id:'pages.login.codeSent',defaultMessage:'验证码已发送'}))
                      } else {
                        message.error(res.msg || intl.formatMessage({id:'pages.login.codeSendFailed',defaultMessage:'获取验证码失败'}))
                        refreshCaptcha()
                        throw new Error(res.msg || intl.formatMessage({id:'pages.login.codeSendFailed',defaultMessage:'获取验证码失败'}))
                      }
                    } catch (errorInfo) {
                      console.log('校验失败:', errorInfo)
                      refreshCaptcha()
                      throw errorInfo
                    }
                  }}
                />
                <ProFormText
                  name='realName'
                  fieldProps={{
                    size: 'large',
                    prefix: <UserOutlined/>,
                  }}
                  placeholder={intl.formatMessage({id:'pages.register.namePlaceholder',defaultMessage:'姓名（可选）'})}
                />
                <ProFormText.Password
                  name='pwd'
                  fieldProps={{
                    size: 'large',
                    prefix: <LockOutlined/>,
                  }}
                  placeholder={intl.formatMessage({id:'pages.login.bind.password',defaultMessage:'密码'})}
                  rules={[
                    {
                      required: true,
                      message: intl.formatMessage({id:'pages.register.pwdRequired',defaultMessage:'请输入密码！'}),
                    },
                    {
                      validator: (_, value) => {
                        if (!value) return Promise.resolve()
                        const check = checkPasswordComplexity(value)
                        if (check.success) {
                          return Promise.resolve()
                        }
                        return Promise.reject(new Error(check.message))
                      },
                    },
                  ]}
                />
                <ProFormText.Password
                  name='confirmPwd'
                  fieldProps={{
                    size: 'large',
                    prefix: <LockOutlined/>,
                  }}
                  placeholder={intl.formatMessage({id:'pages.register.confirmPwd',defaultMessage:'确认密码'})}
                  rules={[
                    {
                      required: true,
                      message: intl.formatMessage({id:'pages.register.confirmPwdRequired',defaultMessage:'请确认密码！'}),
                    },
                    {
                      validator: (_, value) => {
                        const pwd = form.getFieldValue('pwd')
                        if (!value || pwd === value) {
                          return Promise.resolve()
                        }
                        return Promise.reject(new Error(intl.formatMessage({id:'pages.register.pwdMismatch',defaultMessage:'两次输入的密码不一致！'})))
                      },
                    },
                  ]}
                />
              </>
            )}

            {type === 'email' && (
              <>
                <ProFormText
                  fieldProps={{
                    size: 'large',
                    prefix: <MailOutlined/>,
                  }}
                  name='email'
                  placeholder={intl.formatMessage({id:'pages.login.email.placeholder',defaultMessage:'电子邮箱'})}
                  rules={[
                    {
                      required: true,
                      message: intl.formatMessage({id:'pages.login.email.required',defaultMessage:'请输入邮箱！'}),
                    },
                    {
                      pattern: emailPattern,
                      message: intl.formatMessage({id:'pages.login.email.invalid',defaultMessage:'邮箱格式错误！'}),
                    },
                  ]}
                />
                <ProFormText
                  name='captcha'
                  fieldProps={{
                    size: 'large',
                    prefix: <SafetyOutlined/>,
                    suffix: <div className={styles.captcha} title={intl.formatMessage({id:'pages.login.captcha.refresh',defaultMessage:'点击刷新验证码'})} onClick={refreshCaptcha}
                                 dangerouslySetInnerHTML={{__html: captchaHtml}}/>
                  }}
                  placeholder={intl.formatMessage({id:'pages.login.imageCaptcha.placeholder',defaultMessage:'图形码'})}
                  rules={[
                    {
                      required: true,
                      message: intl.formatMessage({id:'pages.login.imageCaptcha.required',defaultMessage:'请输入图形码!'}),
                    },
                  ]}
                />
                <ProFormCaptcha
                  fieldProps={{
                    size: 'large',
                    prefix: <LockOutlined/>,
                  }}
                  captchaProps={{
                    size: 'large',
                  }}
                  placeholder={intl.formatMessage({id:'pages.tab.email',defaultMessage:'邮箱验证码'})}
                  captchaTextRender={(timing, count) => {
                    if (timing) {
                      return `${count} 秒后重发`
                    }
                    return intl.formatMessage({id:'pages.login.getCode',defaultMessage:'获取验证码'})
                  }}
                  name='emailCode'
                  rules={[
                    {
                      required: true,
                      message: intl.formatMessage({id:'pages.login.captcha.req',defaultMessage:'请输入验证码！'}),
                    },
                  ]}
                  onGetCaptcha={async () => {
                    try {
                      await form.validateFields(['email', 'captcha'])
                      const email = form.getFieldValue('email')
                      const captcha = form.getFieldValue('captcha')
                      const currentCaptchaKey = captchaKey
                      if (!email || !captcha || !currentCaptchaKey) {
                        if (!currentCaptchaKey) {
                          message.error(intl.formatMessage({id:'pages.login.captchaFirst',defaultMessage:'请先获取图形验证码'}))
                          refreshCaptcha()
                          throw new Error(intl.formatMessage({id:'pages.login.captchaFirst',defaultMessage:'请先获取图形验证码'}))
                        } else {
                          message.error(intl.formatMessage({id:'pages.register.emailAndCaptcha',defaultMessage:'请填写邮箱和图形验证码'}))
                          throw new Error(intl.formatMessage({id:'pages.register.emailAndCaptcha',defaultMessage:'请填写邮箱和图形验证码'}))
                        }
                      }

                      const res = await emailRegisterVerify(email, currentCaptchaKey, captcha)
                      if (res.code === 0) {
                        message.success(intl.formatMessage({id:'pages.login.codeSent',defaultMessage:'验证码已发送'}))
                      } else {
                        message.error(res.msg || intl.formatMessage({id:'pages.login.codeSendFailed',defaultMessage:'获取验证码失败'}))
                        refreshCaptcha()
                        throw new Error(res.msg || intl.formatMessage({id:'pages.login.codeSendFailed',defaultMessage:'获取验证码失败'}))
                      }
                    } catch (errorInfo) {
                      console.log('校验失败:', errorInfo)
                      refreshCaptcha()
                      throw errorInfo
                    }
                  }}
                />
                <ProFormText
                  name='realName'
                  fieldProps={{
                    size: 'large',
                    prefix: <UserOutlined/>,
                  }}
                  placeholder={intl.formatMessage({id:'pages.register.namePlaceholder',defaultMessage:'姓名（可选）'})}
                />
                <ProFormText.Password
                  name='pwd'
                  fieldProps={{
                    size: 'large',
                    prefix: <LockOutlined/>,
                  }}
                  placeholder={intl.formatMessage({id:'pages.login.bind.password',defaultMessage:'密码'})}
                  rules={[
                    {
                      required: true,
                      message: intl.formatMessage({id:'pages.register.pwdRequired',defaultMessage:'请输入密码！'}),
                    },
                    {
                      validator: (_, value) => {
                        if (!value) return Promise.resolve()
                        const check = checkPasswordComplexity(value)
                        if (check.success) {
                          return Promise.resolve()
                        }
                        return Promise.reject(new Error(check.message))
                      },
                    },
                  ]}
                />
                <ProFormText.Password
                  name='confirmPwd'
                  fieldProps={{
                    size: 'large',
                    prefix: <LockOutlined/>,
                  }}
                  placeholder={intl.formatMessage({id:'pages.register.confirmPwd',defaultMessage:'确认密码'})}
                  rules={[
                    {
                      required: true,
                      message: intl.formatMessage({id:'pages.register.confirmPwdRequired',defaultMessage:'请确认密码！'}),
                    },
                    {
                      validator: (_, value) => {
                        const pwd = form.getFieldValue('pwd')
                        if (!value || pwd === value) {
                          return Promise.resolve()
                        }
                        return Promise.reject(new Error(intl.formatMessage({id:'pages.register.pwdMismatch',defaultMessage:'两次输入的密码不一致！'})))
                      },
                    },
                  ]}
                />
              </>
            )}

            <div
              style={{
                marginBottom: 24,
                display: 'flex',
                justifyContent: 'center'
              }}
            >
              <a
                onClick={() => {
                  history.replace(`/user/login${history.location.search}`)
                }}
              >
                已有账号？去登录
              </a>
            </div>
          </LoginForm>
        </div>
      </div>
      <Footer style={{background: 'rgba(245,245,245,0.6)'}}/>
    </div>
  )
}

export default Register
