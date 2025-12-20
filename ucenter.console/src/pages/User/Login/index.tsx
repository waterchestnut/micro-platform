// @ts-ignore
/* eslint-disable */
import {Footer} from '@/components'
import {login, phoneLogin, phoneLoginVerify, emailLoginVerify, emailLogin} from '@/services/ucenter/userAuth'
import {
  AlipayCircleOutlined, AlipayOutlined,
  LockOutlined, MailOutlined,
  MobileOutlined, ReconciliationOutlined, SafetyOutlined,
  TaobaoCircleOutlined, TaobaoOutlined,
  UserOutlined, WechatOutlined,
  WeiboCircleOutlined, WeiboOutlined,
} from '@ant-design/icons'
import {
  LoginForm,
  ProFormCaptcha,
  ProFormCheckbox,
  ProFormText,
} from '@ant-design/pro-components'
import {FormattedMessage, history, SelectLang, useIntl, useModel, Helmet} from '@umijs/max'
// 1. 从 antd 导入 Form
import {Alert, Divider, message, Space, Tabs, theme, Form} from 'antd'
import Settings from '../../../../config/defaultSettings'
import React, {useEffect, useState} from 'react'
import {flushSync} from 'react-dom' // 注意：flushSync 在此场景下可能非必需，但按要求保留
import {createStyles} from 'antd-style'
import {emailPattern} from '@/utils/validator'
import {getCaptcha} from '@/services/ucenter/captcha'
import {errorMessage, successMessage} from '@/utils/msg'
import {ResponseStructure} from '@/services/request' // 按要求保留
import {setCookie} from '@/utils/cookie'

interface LoginResult {
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
      /*backgroundImage:
        "url('/images/login_bg.png')",
      backgroundSize: '100% 100%',*/
      background: 'rgba(245, 245, 245, 0.6)',
    },
    iconStyles: {
      color: 'rgba(0, 0, 0, 0.2)',
      fontSize: '18px',
      verticalAlign: 'middle',
      cursor: 'pointer',
    },
    captcha: {
      width: '100px',
      cursor: 'pointer',
      margin: '-15px',
      '& svg': {
        width: '100px',
        height: '40px'
      }
    }
  }
})

const LoginMessage: React.FC<{
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

const Login: React.FC = () => {
  const [userLoginState, setUserLoginState] = useState<LoginResult>({})
  const [type, setType] = useState<string>('account')
  const {initialState, setInitialState} = useModel('@@initialState')
  const {styles} = useStyles()
  const intl = useIntl()
  const [captchaKey, setCaptchaKey] = useState('')
  const [captchaHtml, setCaptchaHtml] = useState('')
  const {token} = theme.useToken()
  // 2. 使用 useForm Hook 获取 form 实例
  const [form] = Form.useForm()

  useEffect(() => {
    refreshCaptcha()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // 保留原有的依赖数组

  const refreshCaptcha = async () => {
    // 保留原有的 refreshCaptcha 逻辑
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
      // 登录
      let res
      if (type === 'account') {
        // 账户密码登录
        // 将 captchaKey 添加到请求参数中，如果后端需要的话
        res = await login(values.username, values.pwd, captchaKey, values.captcha)
      } else if (type === 'mobile') {
        res = await phoneLogin(values.mobile, values.smsCode)
      } else if (type === 'email') {
        // 邮箱登录（需补充）
        // 同样，根据后端接口定义传递所需参数
        // res = await emailLogin(values.email, values.emailCode, captchaKey, values.captcha);
        res = await emailLogin(values.email, values.emailCode)
      }

      if (res?.code === 0) {
        const defaultLoginSuccessMessage = intl.formatMessage({
          id: 'pages.login.success',
          defaultMessage: '登录成功！',
        })
        successMessage(defaultLoginSuccessMessage)
        setCookie('param-accessToken', res.data.accessToken) // 假设返回结构中有 accessToken

        // 刷新状态的逻辑保持不变
        // const userInfo = await initialState?.fetchUserInfo?.();
        // if (userInfo) {
        //   flushSync(() => {
        //     setInitialState((s) => ({
        //       ...s,
        //       currentUser: userInfo,
        //     }));
        //   });
        // }

        const urlParams = new URL(window.location.href).searchParams
        // 跳转逻辑保持不变 (虽然建议用 history.push)
        location.href = urlParams.get('retUrl') || '/'
        return
      }
      //console.log(res) // 保留 console.log
      // 如果失败去设置用户错误信息
      setUserLoginState({status: 'error', type, msg: res?.msg || '用户名或密码错误'}) // 错误信息保持不变
      refreshCaptcha()
    } catch (error) {
      const defaultLoginFailureMessage = intl.formatMessage({
        id: 'pages.login.failure',
        defaultMessage: '登录失败，请重试！',
      })
      console.log(error) // 保留 console.log
      errorMessage(defaultLoginFailureMessage) // 错误信息保持不变
      refreshCaptcha()
    }
  }


  const {status, type: loginType, msg} = userLoginState

  return (
    <div className={styles.container}>
      <Helmet>
        <title>
          {intl.formatMessage({
            id: 'menu.login',
            defaultMessage: '登录页',
          })}
          - {Settings.title}
        </title>
      </Helmet>
      {/* 背景视频部分保持不变 */}
      {/*<video autoPlay
             playsInline loop muted crossOrigin="anonymous"
             style={
               {
                 width: '100%',
                 height: '100%',
                 objectFit: 'cover',
                 position: 'fixed',
                 zIndex: '-1'
               }
             }>
        <source type='video/mp4'
                src="/images/earth.mp4"/>
      </video>*/}
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
          {/* 3. 将 form 实例传递给 LoginForm */}
          <LoginForm
            form={form} // 添加 form prop
            name='loginForm' // 设置表单名字
            containerStyle={ // 保留原有样式
              {
                borderRadius: 8,
              }
            }
            contentStyle={{ // 保留原有样式
              minWidth: 380,
              maxWidth: '75vw',
            }}
            logo={<img alt='logo' src='/logo.svg'/>}
            title='微平台'
            subTitle={intl.formatMessage({id: 'pages.layouts.userLayout.title'})}
            initialValues={{ // 保留原有 initialValues
              autoLogin: true,
            }}
            actions={ // 保留原有 actions
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  flexDirection: 'column',
                }}
              >
                <Divider plain>
              <span
                style={{
                  color: token.colorTextPlaceholder,
                  fontWeight: 'normal',
                  fontSize: 14,
                }}
              >
                其他登录方式
              </span>
                </Divider>
                <Space align='center' size={24}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      flexDirection: 'column',
                      height: 40,
                      width: 40,
                      border: '1px solid ' + token.colorPrimaryBorder,
                      borderRadius: '50%',
                    }}
                    title='教务系统登录'
                  >
                    <ReconciliationOutlined className={styles.iconStyles} style={{color: '#1677FF'}}/>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      flexDirection: 'column',
                      height: 40,
                      width: 40,
                      border: '1px solid ' + token.colorPrimaryBorder,
                      borderRadius: '50%',
                    }}
                    title='微信扫码登录'
                  >
                    <WechatOutlined className={styles.iconStyles} style={{color: '#FF6A10'}}/>
                  </div>
                </Space>
              </div>
            }
            onFinish={async (values) => { // 保留原有 onFinish
              await handleSubmit(values)
            }}
          >
            <Tabs
              activeKey={type}
              onChange={setType} // 保留原有 onChange
              centered
              items={[ // 保留原有 items
                {
                  key: 'account',
                  label: intl.formatMessage({
                    id: 'pages.login.accountLogin.tab',
                    defaultMessage: '账户密码登录',
                  }),
                },
                {
                  key: 'mobile',
                  label: intl.formatMessage({
                    id: 'pages.login.phoneLogin.tab',
                    defaultMessage: '手机验证码登录',
                  }),
                },
                {
                  key: 'email',
                  label: '邮箱验证码登录',
                },
              ]}
            />

            {status === 'error' && msg && ( // 保留原有错误信息显示逻辑
              <LoginMessage
                content={msg}
              />
            )}
            {type === 'account' && ( // 账户登录部分保持不变
              <>
                <ProFormText
                  name='username'
                  fieldProps={{
                    size: 'large',
                    prefix: <UserOutlined/>,
                  }}
                  placeholder={intl.formatMessage({
                    id: 'pages.login.username.placeholder',
                    defaultMessage: '用户名/手机号/邮箱',
                  })}
                  rules={[
                    {
                      required: true,
                      message: (
                        <FormattedMessage
                          id='pages.login.username.required'
                          defaultMessage='请输入用户名!'
                        />
                      ),
                    },
                  ]}
                />
                <ProFormText.Password
                  name='pwd'
                  fieldProps={{
                    size: 'large',
                    prefix: <LockOutlined/>,
                  }}
                  placeholder={intl.formatMessage({
                    id: 'pages.login.password.placeholder',
                    defaultMessage: '密码',
                  })}
                  rules={[
                    {
                      required: true,
                      message: (
                        <FormattedMessage
                          id='pages.login.password.required'
                          defaultMessage='请输入密码！'
                        />
                      ),
                    },
                  ]}
                />
                <ProFormText
                  name='captcha'
                  fieldProps={{
                    size: 'large',
                    prefix: <SafetyOutlined/>,
                    suffix: <div className={styles.captcha} title='点击刷新验证码' onClick={refreshCaptcha}
                                 dangerouslySetInnerHTML={{__html: captchaHtml}}/>
                  }}
                  placeholder='图形码'
                  rules={[
                    {
                      required: true,
                      message: '请输入图形码!',
                    },
                  ]}
                />
              </>
            )}

            {type === 'mobile' && (
              <>
                <ProFormText // 手机号输入框保持不变
                  fieldProps={{
                    size: 'large',
                    prefix: <MobileOutlined/>,
                  }}
                  name='mobile'
                  placeholder={intl.formatMessage({
                    id: 'pages.login.phoneNumber.placeholder',
                    defaultMessage: '手机号',
                  })}
                  rules={[
                    {
                      required: true,
                      message: (
                        <FormattedMessage
                          id='pages.login.phoneNumber.required'
                          defaultMessage='请输入手机号！'
                        />
                      ),
                    },
                    {
                      pattern: /^1\d{10}$/,
                      message: (
                        <FormattedMessage
                          id='pages.login.phoneNumber.invalid'
                          defaultMessage='手机号格式错误！'
                        />
                      ),
                    },
                  ]}
                />
                <ProFormText // 图形码输入框保持不变
                  name='captcha'
                  fieldProps={{
                    size: 'large',
                    prefix: <SafetyOutlined/>,
                    suffix: <div className={styles.captcha} title='点击刷新验证码' onClick={refreshCaptcha}
                                 dangerouslySetInnerHTML={{__html: captchaHtml}}/>
                  }}
                  placeholder='图形码'
                  rules={[
                    {
                      required: true,
                      message: '请输入图形码!',
                    },
                  ]}
                />
                <ProFormCaptcha
                  fieldProps={{ // 验证码输入框样式保持不变
                    size: 'large',
                    prefix: <LockOutlined/>,
                  }}
                  captchaProps={{ // 验证码按钮样式保持不变
                    size: 'large',
                  }}
                  placeholder={intl.formatMessage({ // 占位符保持不变
                    id: 'pages.login.captcha.placeholder',
                    defaultMessage: '请输入验证码',
                  })}
                  captchaTextRender={(timing, count) => { // 按钮文字逻辑保持不变
                    if (timing) {
                      return `${count} ${intl.formatMessage({
                        id: 'pages.getCaptchaSecondText',
                        defaultMessage: '获取验证码', // 或 '秒后重发'
                      })}`
                    }
                    return intl.formatMessage({//获取手机验证码
                      id: 'pages.login.phoneLogin.getVerificationCode',
                      defaultMessage: '获取验证码',
                    })
                  }}
                  name='smsCode' // 字段名保持不变
                  rules={[ // 校验规则保持不变
                    {
                      required: true,
                      message: (
                        <FormattedMessage
                          id='pages.login.captcha.required'
                          defaultMessage='请输入验证码！'
                        />
                      ),
                    },
                  ]}
                  // 4. 修改手机号的 onGetCaptcha 回调
                  onGetCaptcha={async () => {
                    try {
                      // 先校验手机号和图形验证码字段
                      await form.validateFields(['mobile', 'captcha'])
                      // 从 form 实例中获取值
                      const mobile = form.getFieldValue('mobile')
                      const captcha = form.getFieldValue('captcha')
                      const currentCaptchaKey = captchaKey // 使用状态中的 captchaKey
                      // 基本的值检查（虽然 validateFields 会处理，但以防万一）
                      if (!mobile || !captcha || !currentCaptchaKey) {
                        if (!currentCaptchaKey) {
                          message.error('请先获取图形验证码')
                          refreshCaptcha()
                        } else {
                          message.error('请填写手机号和图形验证码')
                        }
                        return
                      }

                      // 调用验证码接口
                      const res = await phoneLoginVerify(mobile, currentCaptchaKey, captcha)
                      if (res.code === 0) {
                        message.success('验证码已发送')
                      } else {
                        message.error(res.msg || '获取验证码失败')
                        refreshCaptcha() // 失败时刷新图形验证码
                      }
                    } catch (errorInfo) {
                      // validateFields 校验失败会到这里
                      console.log('校验失败:', errorInfo) // 保留日志供调试
                      refreshCaptcha() // 校验失败也刷新图形码
                    }
                  }}
                />
              </>
            )}

            {type === 'email' && (
              <>
                <ProFormText // 邮箱输入框保持不变
                  fieldProps={{
                    size: 'large',
                    prefix: <MailOutlined/>,
                  }}
                  name='email'
                  placeholder='电子邮箱'
                  rules={[
                    {
                      required: true,
                      message: '请输入邮箱！',
                    },
                    {
                      pattern: emailPattern,
                      message: '邮箱格式错误！',
                    },
                  ]}
                />
                <ProFormText // 图形码输入框保持不变
                  name='captcha'
                  fieldProps={{
                    size: 'large',
                    prefix: <SafetyOutlined/>,
                    suffix: <div className={styles.captcha} title='点击刷新验证码' onClick={refreshCaptcha}
                                 dangerouslySetInnerHTML={{__html: captchaHtml}}/>
                  }}
                  placeholder='图形码'
                  rules={[
                    {
                      required: true,
                      message: '请输入图形码!',
                    },
                  ]}
                />
                <ProFormCaptcha
                  fieldProps={{ // 验证码输入框样式保持不变
                    size: 'large',
                    prefix: <LockOutlined/>,
                  }}
                  captchaProps={{ // 验证码按钮样式保持不变
                    size: 'large',
                  }}
                  placeholder={intl.formatMessage({ // 占位符保持不变
                    id: 'pages.login.captcha.placeholder',
                    defaultMessage: '请输入验证码',
                  })}
                  captchaTextRender={(timing, count) => { // 按钮文字逻辑保持不变
                    if (timing) {
                      return `${count} ${intl.formatMessage({
                        id: 'pages.getCaptchaSecondText',
                        defaultMessage: '获取验证码', // 或 '秒后重发'
                      })}`
                    }
                    return intl.formatMessage({  //获取邮箱验证码
                      id: 'pages.login.phoneLogin.getVerificationCode', // 可改为 email 专用 id
                      defaultMessage: '获取验证码',
                    })
                  }}
                  name='emailCode'// 字段名保持不变
                  rules={[ // 校验规则保持不变
                    {
                      required: true,
                      message: (
                        <FormattedMessage
                          id='pages.login.captcha.required'
                          defaultMessage='请输入验证码！'
                        />
                      ),
                    },
                  ]}
                  // 5. 修改邮箱的 onGetCaptcha 回调
                  onGetCaptcha={async () => {
                    try {
                      // 先校验手机号和图形验证码字段
                      await form.validateFields(['email', 'captcha'])
                      // 从 form 实例中获取值
                      const email = form.getFieldValue('email')
                      const captcha = form.getFieldValue('captcha')
                      const currentCaptchaKey = captchaKey // 使用状态中的 captchaKey
                      // 基本的值检查（虽然 validateFields 会处理，但以防万一）
                      if (!email || !captcha || !currentCaptchaKey) {
                        if (!currentCaptchaKey) {
                          message.error('请先获取图形验证码')
                          refreshCaptcha()
                        } else {
                          message.error('请填写邮箱号和图形验证码')
                        }
                        return
                      }

                      // 调用验证码接口
                      const res = await emailLoginVerify(email, currentCaptchaKey, captcha)
                      if (res.code === 0) {
                        message.success('验证码已发送')
                      } else {
                        message.error(res.msg || '获取验证码失败')
                        refreshCaptcha() // 失败时刷新图形验证码
                      }
                    } catch (errorInfo) {
                      // validateFields 校验失败会到这里
                      console.log('校验失败:', errorInfo) // 保留日志供调试
                      refreshCaptcha() // 校验失败也刷新图形码
                    }
                  }}
                />
              </>
            )}

            <div // 底部链接区域保持不变
              style={{
                marginBottom: 24,
                display: 'flex'
              }}
            >
              {/*<ProFormCheckbox noStyle name="autoLogin">
              <FormattedMessage id="pages.login.rememberMe" defaultMessage="自动登录" />
            </ProFormCheckbox>*/}
              <a
                style={{
                  display: 'flex',
                  justifyContent: 'right',
                  flex: 1
                }}
              >
                <FormattedMessage id='pages.login.forgotPassword' defaultMessage='忘记密码'/>
              </a>
            </div>
          </LoginForm>
        </div>
      </div>
      <Footer style={{background: 'rgba(245,245,245,0.6)'}}/> {/* Footer 保持不变 */}
    </div>
  )
}

export default Login
