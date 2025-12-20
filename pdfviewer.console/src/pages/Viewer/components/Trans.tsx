import React, {ForwardRefRenderFunction, useEffect, useImperativeHandle, useRef, useState} from 'react'
import {ProCard} from '@ant-design/pro-components'
import {createStyles} from 'antd-style'
import {App, Button, Input, Space, Tooltip} from 'antd'
import {CopyOutlined, TranslationOutlined} from '@ant-design/icons'
import {execTransPicture, execTransText} from '@/services/llm/trans'

const {TextArea} = Input

export type TransComponentProps = {
  originalText?: string;
};

export type TransComponentAction = {
  getTransText: () => string;
  goTrans: (text?: string, imgUrl?: string) => void;
}

const useStyles = createStyles(({token, css}) => {
  return {
    container: {
      height: '100%',
      paddingLeft: '24px',
    },
    actionCon: {
      paddingTop: '12px',
      display: 'flex',
      justifyContent: 'flex-end',
    },
    header: css`
      position: absolute;
      top: 0;
      left: 24px;
      right: 24px;
      z-index: 1;
      background: #fff;
      height: 48px;
      box-sizing: border-box;
      border-bottom: 1px solid rgb(207, 212, 218);
      display: flex;
      align-items: center;
      justify-content: space-between;
    `,
    headerTitle: css`
      font-weight: 600;
      font-size: 15px;
    `,
    headerIcon: css`
      color: ${token.colorPrimary} !important;
      margin-right: 8px;
    `,
    content: css`
      height: 100%;
      overflow: auto;
      padding: 48px 0;
    `,
    transImgCon: css`
      padding-bottom: 8px;

      img {
        max-width: 100%;
        max-height: 300px;
        object-fit: contain;
      }
    `,
  }
})

const TransComponent: ForwardRefRenderFunction<TransComponentAction, TransComponentProps> = (props, ref) => {
  const {originalText = ''} = props
  const {styles} = useStyles()
  const [sourceText, setSourceText] = useState(originalText || '')
  const [transText, setTransText] = useState('')
  const [loading, setLoading] = useState(false)
  const [waitImgUrl, setWaitImgUrl] = useState('')
  const {message} = App.useApp()

  useEffect(() => {
    setSourceText(originalText)
    setTransText('')
    onTransText(originalText)
  }, [originalText])

  useImperativeHandle(ref, () => ({
    getTransText: () => {
      return transText
    },
    goTrans: (text?: string, imgUrl?: string) => {
      setSourceText(text || '')
      setTransText('')
      setWaitImgUrl('')
      if (text) {
        onTransText(text)
      } else if (imgUrl) {
        onTransPicture(imgUrl)
      }
    }
  }))

  const onTransText = async (str?: string) => {
    let textStr = str || sourceText
    if (!textStr) {
      setTransText('')
      return
    }

    setLoading(true)
    let text = await execTransText(textStr)
    setLoading(false)
    setTransText(text)
  }

  const onTransPicture = async (imgUrl: string) => {
    setWaitImgUrl(imgUrl)

    setLoading(true)
    let ret = await execTransPicture(imgUrl)
    setLoading(false)
    setSourceText(ret.ocr)
    setTransText(ret.trans)
  }

  const onCopy = (text: string) => {
    navigator.clipboard.writeText(text)
      .then(() => {
        message.success('已复制')
      })
      .catch(err => {
        console.error(err)
        message.error(`复制失败${err?.message ? '：' + err.message : ''}`)
      })
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerTitle}>
          <TranslationOutlined className={styles.headerIcon}/>翻译助手
        </div>
      </div>
      <div className={styles.content}>
        <ProCard
          title='原文'
          ghost
        >
          {
            waitImgUrl ?
              <div className={styles.transImgCon}><img alt='' src={waitImgUrl}/></div> : null
          }
          <TextArea
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            placeholder='请输入原文'
            autoSize={{minRows: 6, maxRows: 15}}
          />
          <Space className={styles.actionCon}>
            <Tooltip title='复制原文'>
              <Button
                type='link'
                onClick={() => {
                  onCopy(sourceText)
                }}
              >
                <CopyOutlined/>
              </Button>
            </Tooltip>
            <Button
              type='primary'
              loading={loading}
              onClick={async () => {
                await onTransText()
              }}
            >翻译</Button>
          </Space>
        </ProCard>
        <ProCard
          title='译文'
          ghost
        >
          <TextArea
            value={transText}
            onChange={(e) => setTransText(e.target.value)}
            placeholder='等待原文翻译'
            autoSize={{minRows: 6, maxRows: 15}}
            readOnly
          />
          <Space className={styles.actionCon}>
            <Tooltip title='复制译文'>
              <Button
                type='link'
                onClick={() => {
                  onCopy(transText)
                }}
              >
                <CopyOutlined/>
              </Button>
            </Tooltip>
          </Space>
        </ProCard>
      </div>
    </div>
  )
}

export default React.forwardRef(TransComponent)
