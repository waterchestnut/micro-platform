// @ts-ignore
/* eslint-disable */
import {Footer} from '@/components'
import {resetPwdByMobile, resetPwdByEmail} from '@/services/ucenter/userAuth'
import {getSmsCode, getEmailCode} from '@/services/ucenter/userAuth'
import {
  LockOutlined, MailOutlined,
  MobileOutlined, SafetyOutlined,
} from '@ant-design/icons'
import {
  LoginForm,
  ProFormText,
} from '@ant-design/pro-components'
import {FormattedMessage, history, useIntl, Helmet} from '@umijs/max'
import {Alert, message, Tabs, Form, Button} from 'antd'
import Settings from '../../../../config/defaultSettings'
import React, {useState, useEffect} from 'react'
import {createStyles} from 'antd-style'
import {emailPattern, mobilePattern, checkPasswordComplexity} from '@/utils/validator'
import {getCaptcha} from '@/services/ucenter/captcha'
import {errorMessage, successMessage} from '@/utils/msg'

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
    },
  }
})

const ErrorMessage: React.FC<{content: string}> = ({content}) => (
  <Alert style={{marginBottom: 24}} message={content} type='error' showIcon />
)

const Forget: React.FC = () => {
  const [type, setType] = useState<string>('phone')
  const [errorInfo, setErrorInfo] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [smsSending, setSmsSending] = useState(false)
  const [smsCountdown, setSmsCountdown] = useState(0)
  const [emailSending, setEmailSending] = useState(false)
  const [emailCountdown, setEmailCountdown] = useState(0)
  const {styles} = useStyles()
  const intl = useIntl()
  const [form] = Form.useForm()

  const [phoneCaptchaKey, setPhoneCaptchaKey] = useState('')
  const [phoneCaptchaHtml, setPhoneCaptchaHtml] = useState('')
  const [emailCaptchaKey, setEmailCaptchaKey] = useState('')
  const [emailCaptchaHtml, setEmailCaptchaHtml] = useState('')

  useEffect(() => { if (type === 'phone') refreshPhoneCaptcha(); else refreshEmailCaptcha() }, [type])

  const refreshPhoneCaptcha = async () => {
    const res = await getCaptcha(phoneCaptchaKey)
    if (res.code === 0) {
      setPhoneCaptchaKey(res.data.key)
      setPhoneCaptchaHtml(res.data.image)
    }
  }

  const refreshEmailCaptcha = async () => {
    const res = await getCaptcha(emailCaptchaKey)
    if (res.code === 0) {
      setEmailCaptchaKey(res.data.key)
      setEmailCaptchaHtml(res.data.image)
    }
  }

  const startCountdown = (setter: React.Dispatch<React.SetStateAction<number>>) => {
    setter(60)
    const timer = setInterval(() => {
      setter(prev => {
        if (prev <= 1) { clearInterval(timer); return 0 }
        return prev - 1
      })
    }, 1000)
  }

  const handleGetSmsCode = async () => {
    try {
      await form.validateFields(['mobile', 'phoneCaptcha'])
      const mobile = form.getFieldValue('mobile')
      const captcha = form.getFieldValue('phoneCaptcha')
      setSmsSending(true)
      const res = await getSmsCode(mobile, phoneCaptchaKey, captcha)
      if (res.code === 0) {
        message.success(intl.formatMessage({id:'pages.login.codeSent',defaultMessage:'验证码已发送'}))
        startCountdown(setSmsCountdown)
      } else {
        message.error(res.msg || intl.formatMessage({id:'pages.login.codeSendFailed',defaultMessage:'获取验证码失败'}))
        refreshPhoneCaptcha()
      }
    } catch (e: any) {
      refreshPhoneCaptcha()
      if (e?.errorFields) return
    } finally {
      setSmsSending(false)
    }
  }

  const handleGetEmailCode = async () => {
    try {
      await form.validateFields(['email', 'emailCaptcha'])
      const email = form.getFieldValue('email')
      const captcha = form.getFieldValue('emailCaptcha')
      setEmailSending(true)
      const res = await getEmailCode(email, emailCaptchaKey, captcha)
      if (res.code === 0) {
        message.success(intl.formatMessage({id:'pages.login.codeSent',defaultMessage:'验证码已发送'}))
        startCountdown(setEmailCountdown)
      } else {
        message.error(res.msg || intl.formatMessage({id:'pages.login.codeSendFailed',defaultMessage:'获取验证码失败'}))
        refreshEmailCaptcha()
      }
    } catch (e: any) {
      refreshEmailCaptcha()
      if (e?.errorFields) return
    } finally {
      setEmailSending(false)
    }
  }

  const handleSubmit = async () => {
    setErrorInfo('')
    try {
      await form.validateFields()
      const values = form.getFieldsValue()
      const newPwd = values.newPassword
      const confirmPwd = values.confirmPassword

      const pwdCheck = checkPasswordComplexity(newPwd)
      if (!pwdCheck.success) {
        setErrorInfo(pwdCheck.message || intl.formatMessage({id:'pages.forget.pwdWeak',defaultMessage:'密码不符合要求'}))
        return
      }
      if (newPwd !== confirmPwd) {
        setErrorInfo(intl.formatMessage({id:'pages.forget.pwdMismatch',defaultMessage:'两次输入的密码不一致'}))
        return
      }

      setSubmitting(true)
      let res
      if (type === 'phone') {
        res = await resetPwdByMobile(values.mobile, values.smsCode, newPwd)
      } else {
        res = await resetPwdByEmail(values.email, values.emailCode, newPwd)
      }

      if (res.code === 0) {
        successMessage(intl.formatMessage({id:'pages.forget.success',defaultMessage:'密码重置成功，请重新登录'}))
        history.replace('/user/login')
      } else {
        setErrorInfo(res.msg || intl.formatMessage({id:'pages.forget.failed',defaultMessage:'重置失败，请重试'}))
      }
    } catch (e: any) {
      if (e?.errorFields) return
      errorMessage(intl.formatMessage({id:'pages.common.opFailed',defaultMessage:'操作失败，请重试'}))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={styles.container}>
      <Helmet>
        <title>
          {intl.formatMessage({id: 'pages.login.forgotPassword', defaultMessage: '忘记密码'})}
          - {Settings.title}
        </title>
      </Helmet>
      <div style={{
        flex: '1', padding: '32px 0', justifyContent: 'center',
        alignItems: 'center', flexDirection: 'column', display: 'flex'
      }}>
        <div style={{
          minWidth: 480, background: 'rgba(255,255,255,0.6)',
          height: 'auto', borderRadius: 8
        }}>
          <LoginForm
            form={form}
            containerStyle={{borderRadius: 8}}
            contentStyle={{minWidth: 380, maxWidth: '75vw'}}
            logo={<img alt='logo' src='/logo.svg'/>}
            title='微平台'
            subTitle={intl.formatMessage({id:'pages.forget.subTitle',defaultMessage:'重置密码'})}
            submitter={{
              resetButtonProps: {style: {display: 'none'}},
              submitButtonProps: {loading: submitting},
              onSubmit: handleSubmit,
              searchConfig: {submitText: intl.formatMessage({id:'pages.forget.subTitle',defaultMessage:'重置密码'})}
            }}
          >
            <Tabs
              activeKey={type}
              onChange={(key) => { setType(key); setErrorInfo(''); form.resetFields() }}
              centered
              items={[
                {key: 'phone', label: intl.formatMessage({id:'pages.tab.phone',defaultMessage:'手机验证码'})},
                {key: 'email', label: intl.formatMessage({id:'pages.tab.email',defaultMessage:'邮箱验证码'})},
              ]}
            />

            {errorInfo && <ErrorMessage content={errorInfo} />}

            {type === 'phone' && (
              <>
                <ProFormText
                  name='mobile'
                  fieldProps={{size: 'large', prefix: <MobileOutlined/>}}
                  placeholder={intl.formatMessage({id:'pages.login.phoneNumber.ph',defaultMessage:'手机号'})}
                  rules={[
                    {required: true, message: intl.formatMessage({id:'pages.login.phoneNumber.required1',defaultMessage:'请输入手机号'})},
                    {pattern: mobilePattern, message: intl.formatMessage({id:'pages.login.phoneNumber.invalid1',defaultMessage:'手机号格式错误'})},
                  ]}
                />
                <ProFormText
                  name='phoneCaptcha'
                  fieldProps={{
                    size: 'large', prefix: <SafetyOutlined/>,
                    suffix: (
                      <div className={styles.captcha}
                           title={intl.formatMessage({id:'pages.login.captcha.refresh',defaultMessage:'点击刷新验证码'})}
                           onClick={refreshPhoneCaptcha}
                           dangerouslySetInnerHTML={{__html: phoneCaptchaHtml}}/>
                    )
                  }}
                  placeholder={intl.formatMessage({id:'pages.login.imageCaptchaVerify.placeholder',defaultMessage:'图形验证码'})}
                  rules={[{required: true, message: intl.formatMessage({id:'pages.login.imageCaptchaVerify.required',defaultMessage:'请输入图形验证码'})}]}
                />
                <ProFormText
                  name='smsCode'
                  fieldProps={{
                    size: 'large', prefix: <LockOutlined/>,
                    suffix: smsCountdown > 0 ? (
                      <span style={{color: '#999', whiteSpace: 'nowrap'}}>{smsCountdown}s后重发</span>
                    ) : (
                      <Button type='link' size='small' loading={smsSending}
                              onClick={handleGetSmsCode}
                              style={{padding: 0, marginRight: -8}}>
{intl.formatMessage({id:'pages.login.getCode',defaultMessage:'获取验证码'})}
                      </Button>
                    )
                  }}
                  placeholder={intl.formatMessage({id:'pages.smsCode.ph',defaultMessage:'短信验证码'})}
                  rules={[{required: true, message: intl.formatMessage({id:'pages.forget.codePh',defaultMessage:'请输入短信验证码'})}]}
                />
              </>
            )}

            {type === 'email' && (
              <>
                <ProFormText
                  name='email'
                  fieldProps={{size: 'large', prefix: <MailOutlined/>}}
                  placeholder={intl.formatMessage({id:'pages.login.email.placeholder',defaultMessage:'电子邮箱'})}
                  rules={[
                    {required: true, message: intl.formatMessage({id:'pages.login.email.required3',defaultMessage:'请输入邮箱'})},
                    {pattern: emailPattern, message: intl.formatMessage({id:'pages.login.email.invalid2',defaultMessage:'邮箱格式错误'})},
                  ]}
                />
                <ProFormText
                  name='emailCaptcha'
                  fieldProps={{
                    size: 'large', prefix: <SafetyOutlined/>,
                    suffix: (
                      <div className={styles.captcha}
                           title={intl.formatMessage({id:'pages.login.captcha.refresh',defaultMessage:'点击刷新验证码'})}
                           onClick={refreshEmailCaptcha}
                           dangerouslySetInnerHTML={{__html: emailCaptchaHtml}}/>
                    )
                  }}
                  placeholder={intl.formatMessage({id:'pages.login.imageCaptchaVerify.placeholder',defaultMessage:'图形验证码'})}
                  rules={[{required: true, message: intl.formatMessage({id:'pages.login.imageCaptchaVerify.required',defaultMessage:'请输入图形验证码'})}]}
                />
                <ProFormText
                  name='emailCode'
                  fieldProps={{
                    size: 'large', prefix: <LockOutlined/>,
                    suffix: emailCountdown > 0 ? (
                      <span style={{color: '#999', whiteSpace: 'nowrap'}}>{emailCountdown}s后重发</span>
                    ) : (
                      <Button type='link' size='small' loading={emailSending}
                              onClick={handleGetEmailCode}
                              style={{padding: 0, marginRight: -8}}>
{intl.formatMessage({id:'pages.login.getCode',defaultMessage:'获取验证码'})}
                      </Button>
                    )
                  }}
                  placeholder={intl.formatMessage({id:'pages.tab.email',defaultMessage:'邮箱验证码'})}
                  rules={[{required: true, message: intl.formatMessage({id:'pages.forget.emailCodeRequired',defaultMessage:'请输入邮箱验证码'})}]}
                />
              </>
            )}

            <ProFormText.Password
              name='newPassword'
              fieldProps={{size: 'large', prefix: <LockOutlined/>}}
              placeholder={intl.formatMessage({id:'pages.forget.newPwdPlaceholder',defaultMessage:'新密码（8-32位，需含大小写字母、数字、符号中的至少三项）'})}
              rules={[{required: true, message: intl.formatMessage({id:'pages.forget.newPwdRequired',defaultMessage:'请输入新密码'})}]}
            />
            <ProFormText.Password
              name='confirmPassword'
              fieldProps={{size: 'large', prefix: <LockOutlined/>}}
              placeholder={intl.formatMessage({id:'pages.forget.confirmPwd',defaultMessage:'确认新密码'})}
              rules={[{required: true, message: intl.formatMessage({id:'pages.forget.confirmAgain',defaultMessage:'请再次输入新密码'})}]}
            />

            <div style={{marginBottom: 24, display: 'flex'}}>
              <a
                style={{
                  display: 'flex',
                  justifyContent: 'right',
                  flex: 1
                }}
                onClick={() => history.replace('/user/login')}
              >
                返回登录
              </a>
            </div>
          </LoginForm>
        </div>
      </div>
      <Footer style={{background: 'rgba(245,245,245,0.6)'}}/>
    </div>
  )
}

export default Forget
