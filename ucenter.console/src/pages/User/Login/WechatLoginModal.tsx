import {Modal, Spin, Result, Button, Input, Space, Tabs} from 'antd'
import {ReloadOutlined, UserOutlined, LockOutlined, SafetyOutlined, MobileOutlined, MailOutlined} from '@ant-design/icons'
import React, {useEffect, useRef, useState} from 'react'
import {
  getWechatAuthUrl,
  getWechatLoginStatus,
  registerWechatUser,
  bindWechatWithLogin,
  getWechatConfig,
} from '@/services/ucenter/wechatAuth'
import {getCaptcha} from '@/services/ucenter/captcha'
import {getPublicKey, getSmsCode, getEmailCode} from '@/services/ucenter/userAuth'
import {errorMessage, successMessage} from '@/utils/msg'
import forge from 'node-forge'

interface WechatLoginModalProps {
  open: boolean
  onCancel: () => void
  onSuccess: (accessToken: string, refreshToken: string) => void
}

type StatusType = 'loading' | 'qrcode' | 'unregistered' | 'bindLogin' | 'expired' | 'error'

const WechatLoginModal: React.FC<WechatLoginModalProps> = ({open, onCancel, onSuccess}) => {
  const [status, setStatus] = useState<StatusType>('loading')
  const [authUrl, setAuthUrl] = useState('')
  const [stateKey, setStateKey] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [nickName, setNickName] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [allowRegister, setAllowRegister] = useState(true)
  const pollingRef = useRef<ReturnType<typeof setInterval>>()
  const imgRef = useRef<HTMLImageElement>(null)

  const [bindUsername, setBindUsername] = useState('')
  const [bindPassword, setBindPassword] = useState('')
  const [bindCaptcha, setBindCaptcha] = useState('')
  const [bindCaptchaKey, setBindCaptchaKey] = useState('')
  const [bindCaptchaHtml, setBindCaptchaHtml] = useState('')
  const [bindLoading, setBindLoading] = useState(false)
  const [bindTab, setBindTab] = useState('account')
  const [bindPhone, setBindPhone] = useState('')
  const [bindPhoneCaptcha, setBindPhoneCaptcha] = useState('')
  const [bindPhoneCaptchaKey, setBindPhoneCaptchaKey] = useState('')
  const [bindPhoneCaptchaHtml, setBindPhoneCaptchaHtml] = useState('')
  const [bindSmsCode, setBindSmsCode] = useState('')
  const [bindEmail, setBindEmail] = useState('')
  const [bindEmailCaptcha, setBindEmailCaptcha] = useState('')
  const [bindEmailCaptchaKey, setBindEmailCaptchaKey] = useState('')
  const [bindEmailCaptchaHtml, setBindEmailCaptchaHtml] = useState('')
  const [bindEmailCode, setBindEmailCode] = useState('')

  const loadQrCode = async () => {
    setStatus('loading')
    try {
      const [authRes, configRes] = await Promise.all([getWechatAuthUrl(), getWechatConfig()])
      if (configRes.code === 0) {
        setAllowRegister(configRes.data.allowRegister !== false)
      }
      if (authRes.code !== 0) {
        setStatus('error')
        setErrorMsg(authRes.msg || '获取微信登录链接失败')
        return
      }
      setAuthUrl(authRes.data.authUrl)
      setStateKey(authRes.data.state)
      setStatus('qrcode')
      startPolling(authRes.data.state)
    } catch (err) {
      setStatus('error')
      setErrorMsg('网络异常，请重试')
    }
  }

  const startPolling = (state: string) => {
    stopPolling()
    pollingRef.current = setInterval(async () => {
      try {
        const res = await getWechatLoginStatus(state)
        if (res.code !== 0) {
          if (res.code == 7004) {
            setStatus('expired')
            stopPolling()
          }
          return
        }

        const statusData = res.data?.status
        if (statusData === 'success') {
          stopPolling()
          onSuccess(res.data.accessToken, res.data.refreshToken)
        } else if (statusData === 'expired') {
          setStatus('expired')
          stopPolling()
        } else if (statusData === 'unregistered') {
          stopPolling()
          setNickName(res.data.nickName || '')
          setAvatarUrl(res.data.avatarUrl || '')
          setStatus('unregistered')
        }
      } catch (err) {
        // ignore
      }
    }, 2000)
  }

  const stopPolling = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = undefined
    }
  }

  useEffect(() => {
    if (open) {
      loadQrCode()
    } else {
      stopPolling()
      resetState()
    }
    return () => stopPolling()
  }, [open])

  const resetState = () => {
    setAuthUrl('')
    setStateKey('')
    setStatus('loading')
    setErrorMsg('')
    setBindLoading(false)
    setBindTab('account')
    setBindUsername('')
    setBindPassword('')
    setBindCaptcha('')
    setBindCaptchaKey('')
    setBindCaptchaHtml('')
    setBindPhone('')
    setBindPhoneCaptcha('')
    setBindPhoneCaptchaKey('')
    setBindPhoneCaptchaHtml('')
    setBindSmsCode('')
    setBindEmail('')
    setBindEmailCaptcha('')
    setBindEmailCaptchaKey('')
    setBindEmailCaptchaHtml('')
    setBindEmailCode('')
  }

  const handleRegister = async () => {
    try {
      const res = await registerWechatUser(stateKey)
      if (res.code === 0) {
        onSuccess(res.data.accessToken, res.data.refreshToken)
      } else {
        errorMessage(res.msg || '注册失败')
      }
    } catch (err) {
      errorMessage('注册失败，请重试')
    }
  }

  const goBindLogin = async () => {
    setStatus('bindLogin')
    setBindTab('account')
    refreshAccountCaptcha()
  }

  const refreshAccountCaptcha = async () => {
    const res = await getCaptcha(bindCaptchaKey)
    if (res.code === 0) {
      setBindCaptchaKey(res.data.key)
      setBindCaptchaHtml(res.data.image)
    }
  }

  const refreshPhoneCaptcha = async () => {
    const res = await getCaptcha(bindPhoneCaptchaKey)
    if (res.code === 0) {
      setBindPhoneCaptchaKey(res.data.key)
      setBindPhoneCaptchaHtml(res.data.image)
    }
  }

  const refreshEmailCaptcha = async () => {
    const res = await getCaptcha(bindEmailCaptchaKey)
    if (res.code === 0) {
      setBindEmailCaptchaKey(res.data.key)
      setBindEmailCaptchaHtml(res.data.image)
    }
  }

  const handleGetSmsCode = async () => {
    if (!bindPhone) return
    try {
      const res = await getSmsCode(bindPhone, bindPhoneCaptchaKey, bindPhoneCaptcha)
      if (res.code !== 0) {
        errorMessage(res.msg || '获取验证码失败')
        refreshPhoneCaptcha()
      }
    } catch (err) {
      refreshPhoneCaptcha()
    }
  }

  const handleGetEmailCode = async () => {
    if (!bindEmail) return
    try {
      const res = await getEmailCode(bindEmail, bindEmailCaptchaKey, bindEmailCaptcha)
      if (res.code !== 0) {
        errorMessage(res.msg || '获取验证码失败')
        refreshEmailCaptcha()
      }
    } catch (err) {
      refreshEmailCaptcha()
    }
  }

  const doBindLogin = async () => {
    setBindLoading(true)
    try {
      let loginType: string = 'account'
      let params: Record<string, any> = {}

      if (bindTab === 'account') {
        loginType = 'account'
        const publicKeyRes = await getPublicKey()
        const publicK = forge.pki.publicKeyFromPem(publicKeyRes.data)
        const encrypted = btoa(publicK.encrypt(encodeURIComponent(bindPassword), 'RSA-OAEP'))
        params = {username: bindUsername, pwd: encrypted, captchaKey: bindCaptchaKey, captcha: bindCaptcha}
      } else if (bindTab === 'phone') {
        loginType = 'phone'
        params = {phone: bindPhone, verification: bindSmsCode}
      } else if (bindTab === 'email') {
        loginType = 'email'
        params = {email: bindEmail, verification: bindEmailCode}
      }

      const res = await bindWechatWithLogin(stateKey, loginType, params)
      if (res.code === 0) {
        successMessage('绑定成功')
        onSuccess(res.data.accessToken, res.data.refreshToken)
      } else {
        errorMessage(res.msg || '操作失败')
        if (bindTab === 'account') refreshAccountCaptcha()
        else if (bindTab === 'phone') refreshPhoneCaptcha()
        else refreshEmailCaptcha()
      }
    } catch (err) {
      errorMessage('操作失败，请重试')
    } finally {
      setBindLoading(false)
    }
  }

  const qrCodeImgUrl = authUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(authUrl)}`
    : ''

  const renderContent = () => {
    switch (status) {
      case 'loading':
        return (
          <div style={{textAlign: 'center', padding: '60px 0'}}>
            <Spin size='large' tip='加载中...'/>
          </div>
        )

      case 'qrcode':
        return (
          <div style={{textAlign: 'center', padding: '20px 0'}}>
            <p style={{marginBottom: 16, color: '#666'}}>请使用微信扫描二维码登录</p>
            <img
              ref={imgRef}
              src={qrCodeImgUrl}
              alt='微信扫码登录'
              style={{width: 200, height: 200, border: '1px solid #eee', borderRadius: 4}}
              onError={() => { setStatus('error'); setErrorMsg('二维码加载失败') }}
            />
            <p style={{marginTop: 12, color: '#999', fontSize: 12}}>二维码有效期5分钟，请尽快扫码</p>
          </div>
        )

      case 'unregistered':
        return (
          <div style={{textAlign: 'center', padding: '20px 0'}}>
            {nickName && <p style={{fontSize: 16, fontWeight: 500, marginBottom: 12}}>Hi, {nickName}</p>}
            {allowRegister
              ? <p style={{color: '#666', marginBottom: 24}}>该微信未关联平台账号，请选择：</p>
              : <p style={{color: '#666', marginBottom: 24}}>该微信未关联平台账号，请绑定已有账号：</p>
            }
            <Space direction='vertical' size={12} style={{width: '100%'}}>
              {allowRegister && (
                <Button type='primary' block onClick={handleRegister}>
                  注册新账号
                </Button>
              )}
              <Button type={allowRegister ? 'default' : 'primary'} block onClick={goBindLogin}>
                绑定已有账号
              </Button>
            </Space>
          </div>
        )

      case 'bindLogin':
        return (
          <div style={{padding: '10px 0'}}>
            <p style={{color: '#666', marginBottom: 12}}>请输入已有账号信息完成绑定</p>
            <Tabs
              activeKey={bindTab}
              onChange={(key) => {
                setBindTab(key)
                if (key === 'account') refreshAccountCaptcha()
                else if (key === 'phone') refreshPhoneCaptcha()
                else refreshEmailCaptcha()
              }}
              size='small'
              centered
              items={[
                {
                  key: 'account',
                  label: '账户密码',
                  children: (
                    <div>
                      <Input prefix={<UserOutlined/>} placeholder='用户名/手机号/邮箱'
                             style={{marginBottom: 12}}
                             value={bindUsername} onChange={e => setBindUsername(e.target.value)} />
                      <Input.Password prefix={<LockOutlined/>} placeholder='密码'
                                      style={{marginBottom: 12}}
                                      value={bindPassword} onChange={e => setBindPassword(e.target.value)} />
                      <Input prefix={<SafetyOutlined/>} placeholder='图形验证码'
                             value={bindCaptcha} onChange={e => setBindCaptcha(e.target.value)}
                             suffix={<div dangerouslySetInnerHTML={{__html: bindCaptchaHtml}}
                                           onClick={refreshAccountCaptcha}
                                           style={{cursor: 'pointer', width: 80, height: 32}}/>} />
                    </div>
                  )
                },
                {
                  key: 'phone',
                  label: '手机验证码',
                  children: (
                    <div>
                      <Input prefix={<MobileOutlined/>} placeholder='手机号'
                             style={{marginBottom: 12}}
                             value={bindPhone} onChange={e => setBindPhone(e.target.value)} />
                      <Input prefix={<SafetyOutlined/>} placeholder='图形验证码'
                             style={{marginBottom: 12}}
                             value={bindPhoneCaptcha} onChange={e => setBindPhoneCaptcha(e.target.value)}
                             suffix={<div dangerouslySetInnerHTML={{__html: bindPhoneCaptchaHtml}}
                                           onClick={refreshPhoneCaptcha}
                                           style={{cursor: 'pointer', width: 80, height: 32}}/>} />
                      <Input prefix={<LockOutlined/>} placeholder='短信验证码'
                             value={bindSmsCode} onChange={e => setBindSmsCode(e.target.value)}
                             suffix={<a onClick={handleGetSmsCode}>获取验证码</a>} />
                    </div>
                  )
                },
                {
                  key: 'email',
                  label: '邮箱验证码',
                  children: (
                    <div>
                      <Input prefix={<MailOutlined/>} placeholder='邮箱'
                             style={{marginBottom: 12}}
                             value={bindEmail} onChange={e => setBindEmail(e.target.value)} />
                      <Input prefix={<SafetyOutlined/>} placeholder='图形验证码'
                             style={{marginBottom: 12}}
                             value={bindEmailCaptcha} onChange={e => setBindEmailCaptcha(e.target.value)}
                             suffix={<div dangerouslySetInnerHTML={{__html: bindEmailCaptchaHtml}}
                                           onClick={refreshEmailCaptcha}
                                           style={{cursor: 'pointer', width: 80, height: 32}}/>} />
                      <Input prefix={<LockOutlined/>} placeholder='邮箱验证码'
                             value={bindEmailCode} onChange={e => setBindEmailCode(e.target.value)}
                             suffix={<a onClick={handleGetEmailCode}>获取验证码</a>} />
                    </div>
                  )
                },
              ]}
            />
            <div style={{marginTop: 6, display: 'flex', gap: 8}}>
              <Button block onClick={() => setStatus('unregistered')}>返回</Button>
              <Button type='primary' block loading={bindLoading} onClick={doBindLogin}>登录并绑定</Button>
            </div>
          </div>
        )

      case 'expired':
        return (
          <Result
            status='warning' title='二维码已过期' subTitle='请刷新二维码后重新扫码'
            extra={<Button type='primary' icon={<ReloadOutlined/>} onClick={loadQrCode}>刷新二维码</Button>}
          />
        )

      case 'error':
        return (
          <Result
            status='error' title='加载失败' subTitle={errorMsg || '未知错误'}
            extra={<Button type='primary' icon={<ReloadOutlined/>} onClick={loadQrCode}>重新加载</Button>}
          />
        )

      default:
        return null
    }
  }

  return (
    <Modal
      title='微信扫码登录'
      open={open}
      onCancel={onCancel}
      footer={null}
      width={420}
      destroyOnClose
      centered
    >
      {renderContent()}
    </Modal>
  )
}

export default WechatLoginModal