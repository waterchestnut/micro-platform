import React, {useEffect, useRef, useState} from 'react'
import {Button, Card, Modal, Result, Spin} from 'antd'
import {ReloadOutlined, WechatOutlined} from '@ant-design/icons'
import {getWechatBindStatus, getWechatBindUrl, getWechatLoginStatus, unbindWechat} from '@/services/ucenter/wechatAuth'
import {errorMessage, successMessage} from '@/utils/msg'

export type WechatBindEditProps = {
  onEditFinish?: () => void;
}

const WechatBindEdit: React.FC<WechatBindEditProps> = (props) => {
  const {onEditFinish} = props
  const [bound, setBound] = useState(false)
  const [wechatNickName, setWechatNickName] = useState('')
  const [loading, setLoading] = useState(true)
  const [bindModalOpen, setBindModalOpen] = useState(false)
  const [unbindLoading, setUnbindLoading] = useState(false)

  const [qrStatus, setQrStatus] = useState<'loading' | 'qrcode' | 'expired' | 'error'>('loading')
  const [qrAuthUrl, setQrAuthUrl] = useState('')
  const [qrErrorMsg, setQrErrorMsg] = useState('')
  const pollingRef = useRef<ReturnType<typeof setInterval>>()

  const fetchStatus = async () => {
    setLoading(true)
    try {
      const res = await getWechatBindStatus()
      if (res.code === 0) {
        setBound(res.data.bound)
        setWechatNickName(res.data.nickName || '')
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchStatus()
  }, [])

  const loadBindQrCode = async () => {
    setQrStatus('loading')
    try {
      const res = await getWechatBindUrl()
      if (res.code !== 0) {
        setQrStatus('error')
        setQrErrorMsg(res.msg || '获取绑定二维码失败')
        return
      }
      setQrAuthUrl(res.data.authUrl)
      setQrStateKey(res.data.state)
      setQrStatus('qrcode')
      startBindPolling(res.data.state)
    } catch (err) {
      setQrStatus('error')
      setQrErrorMsg('网络异常，请重试')
    }
  }

  const startBindPolling = (state: string) => {
    stopBindPolling()
    pollingRef.current = setInterval(async () => {
      try {
        const res = await getWechatLoginStatus(state)
        if (res.code === 0 && res.data?.status === 'success') {
          stopBindPolling()
          setBindModalOpen(false)
          successMessage('微信绑定成功')
          fetchStatus()
          if (onEditFinish) onEditFinish()
        } else if (res.code === 7004) {
          setQrStatus('expired')
          stopBindPolling()
        }
      } catch (err) {
        // ignore polling errors
      }
    }, 2000)
  }

  const stopBindPolling = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = undefined
    }
  }

  const handleOpenBind = () => {
    setBindModalOpen(true)
    loadBindQrCode()
  }

  const handleCloseBind = () => {
    stopBindPolling()
    setBindModalOpen(false)
    setQrAuthUrl('')
    setQrStatus('loading')
  }

  const handleUnbind = async () => {
    setUnbindLoading(true)
    try {
      const res = await unbindWechat()
      if (res.code === 0) {
        successMessage('微信解绑成功')
        fetchStatus()
        if (onEditFinish) onEditFinish()
      } else {
        errorMessage(res.msg || '解绑失败')
      }
    } catch (e) {
      console.error(e)
      errorMessage('解绑失败')
    } finally {
      setUnbindLoading(false)
    }
  }

  const qrCodeImgUrl = qrAuthUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrAuthUrl)}`
    : ''

  const renderQrContent = () => {
    switch (qrStatus) {
      case 'loading':
        return <div style={{textAlign: 'center', padding: '60px 0'}}><Spin size='large' tip='加载中...'/></div>
      case 'qrcode':
        return (
          <div style={{textAlign: 'center', padding: '20px 0'}}>
            <p style={{marginBottom: 16, color: '#666'}}>请使用微信扫描二维码完成绑定</p>
            <img
              src={qrCodeImgUrl}
              alt='微信扫码绑定'
              style={{width: 200, height: 200, border: '1px solid #eee', borderRadius: 4}}
              onError={() => { setQrStatus('error'); setQrErrorMsg('二维码加载失败') }}
            />
            <p style={{marginTop: 12, color: '#999', fontSize: 12}}>二维码有效期5分钟</p>
          </div>
        )
      case 'expired':
        return (
          <Result
            status='warning' title='二维码已过期' subTitle='请刷新二维码后重新扫码'
            extra={<Button type='primary' icon={<ReloadOutlined/>} onClick={loadBindQrCode}>刷新二维码</Button>}
          />
        )
      case 'error':
        return (
          <Result
            status='error' title='加载失败' subTitle={qrErrorMsg || '未知错误'}
            extra={<Button type='primary' icon={<ReloadOutlined/>} onClick={loadBindQrCode}>重新加载</Button>}
          />
        )
      default:
        return null
    }
  }

  return (
    <>
      <Card
        title='微信绑定'
        style={{marginBottom: 16}}
        loading={loading}
        extra={
          bound ? (
            <Button danger size='small' loading={unbindLoading} onClick={handleUnbind}>解绑</Button>
          ) : (
            <Button type='primary' size='small' icon={<WechatOutlined/>} onClick={handleOpenBind}>绑定</Button>
          )
        }
      >
        <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
          <WechatOutlined style={{color: '#07C160', fontSize: 20}}/>
          <span>{bound ? `已绑定 (${wechatNickName})` : '未绑定'}</span>
        </div>
      </Card>

      <Modal
        title='绑定微信'
        open={bindModalOpen}
        onCancel={handleCloseBind}
        footer={null}
        width={420}
        destroyOnClose
        centered
      >
        {renderQrContent()}
      </Modal>
    </>
  )
}

export default WechatBindEdit