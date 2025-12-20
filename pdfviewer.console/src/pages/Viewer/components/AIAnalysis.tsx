import React, {ForwardRefRenderFunction, useEffect, useImperativeHandle, useRef, useState} from 'react'
import {
  CloudUploadOutlined,
  CommentOutlined,
  CopyOutlined,
  DislikeOutlined, FileWordFilled, FundViewOutlined, GlobalOutlined,
  LikeOutlined,
  PlusOutlined,
  ScheduleOutlined,
} from '@ant-design/icons'
import {
  Attachments,
  type AttachmentsProps,
  Bubble, BubbleProps,
  Conversations,
  Prompts,
  Sender,
  Suggestion, Think,
  Welcome, XProvider, Mermaid
} from '@ant-design/x'
import zhCN from 'antd/locale/zh_CN'
import zhCN_X from '@ant-design/x/locale/zh_CN'
import XMarkdown, {type ComponentProps} from '@ant-design/x-markdown'
import type {MessageInfo} from '@ant-design/x-sdk'
import {
  useXChat,
  useXConversations,
  XRequest,
} from '@ant-design/x-sdk'
import {Alert, App, Button, GetProp, GetRef, theme, Popover, Result, Space, Spin, Tooltip, Typography, Flex} from 'antd'
import {createStyles} from 'antd-style'
import dayjs from 'dayjs'
import {getAccessToken, getUserCache} from '@/utils/authority'
import {getConversationList} from '@/services/llm/conversation'
import {isArray, uuidV4} from '@/utils/util'
import {feedback, getMessageList} from '@/services/llm/message'
import {useInterval} from 'usehooks-ts'
import {checkResLiterature} from '@/services/resource/literature'
import {history} from '@@/core/history'
import {CopyWordIcon} from '@/icons/copyWord'
import LiteratureChatProvider, {
  LiteratureChatInput,
  LiteratureChatMessage,
  LiteratureChatOutput
} from '@/chatProviders/LiteratureChatProvider'
import Latex from '@ant-design/x-markdown/plugins/Latex'

const {useToken} = theme

const ThinkComponent = React.memo((props: ComponentProps) => {
  const [title, setTitle] = React.useState(`深度思考中...`)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    if (props.streamStatus === 'done') {
      setTitle('深度思考完成')
      setLoading(false)
    }
  }, [props.streamStatus])

  return (
    <Think title={title} loading={loading}>
      {props.children}
    </Think>
  )
})

const Code: React.FC<ComponentProps> = (props) => {
  const {className, children} = props
  const lang = className?.match(/language-(\w+)/)?.[1] || ''

  if (typeof children !== 'string') return null
  if (lang === 'mermaid') {
    return <Mermaid>{children}</Mermaid>
  }
  return <code>{children}</code>
}

const renderMarkdown: BubbleProps['contentRender'] = (content, info) => {
  const newContent = content.replace('/\n\n/g', '<br/><br/>')
  return (
    <XMarkdown
      config={{extensions: Latex()}}
      content={newContent}
      components={{
        think: ThinkComponent,
        code: Code,
      }}
    />
  )
}

const canCacheQueryMap: any = {
  '总结核心内容': 1,
  '提炼关键发现': 1,
  '解析研究方法': 1,
  '明确学术概念': 1,
  '阐明应用价值': 1,
  '探索研究新方向': 1,
}
const MOCK_SUGGESTIONS = [
  {label: '总结核心内容', value: '总结核心内容'},
  {label: '解析研究方法', value: '解析研究方法'},
  {label: '明确学术概念', value: '明确学术概念'},
  {label: '阐明应用价值', value: '阐明应用价值'},
  {
    label: '探索',
    value: 'knowledge',
    icon: <GlobalOutlined/>,
    children: [
      {label: '提炼关键发现', value: '提炼关键发现'},
      {label: '探索研究新方向', value: '探索研究新方向'},
    ],
  },
]
const MOCK_QUESTIONS = [
  '总结核心内容',
  '提炼关键发现',
  '解析研究方法',
  '明确学术概念',
  '阐明应用价值',
  '探索研究新方向',
]
const AGENT_PLACEHOLDER = '正在生产内容，请稍后。。。'

const useCopilotStyle = createStyles(({token, css}) => {
  return {
    copilotChat: css`
      display: flex;
      flex-direction: column;
      background: ${token.colorBgContainer};
      color: ${token.colorText};
      padding-left: 24px;
      height: 100%;
    `,
    // chatHeader 样式
    chatHeader: css`
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
    headerButton: css`
      font-size: 18px;
    `,
    conversations: css`
      width: 300px;

      .ant-conversations-list {
        padding-inline-start: 0;
      }
    `,
    // chatList 样式
    chatList: css`
      margin-block-start: ${token.margin}px;
      display: flex;
      height: calc(100% - 194px);
      flex-direction: column;

      .ant-typography div p:last-child {
        margin-bottom: 0
      }

      img {
        max-width: 300px;
        max-height: 200px;
        object-fit: contain;
      }

      .ant-bubble-body {
        max-width: 100%;
      }
    `,
    chatWelcome: css`
      padding: 12px 16px;
      border-radius: 2px 12px 12px 12px;
      background: ${token.colorBgTextHover};
      margin-bottom: 16px;
    `,
    loadingMessage: css`
      background-image: linear-gradient(90deg, #ff6b23 0%, #af3cb8 31%, #53b6ff 89%);
      background-size: 100% 2px;
      background-repeat: no-repeat;
      background-position: bottom;
    `,
    // chatSend 样式
    chatSend: css`
      padding: 12px 0;
    `,
    speechButton: css`
      font-size: 18px;
      color: ${token.colorText} !important;
    `,
  }
})

export type AIAnalysisComponentProps = {
  sourceText?: boolean;
  literatureInfo: any;
};

export type AIAnalysisComponentAction = {
  getAIAnalysisStatus: () => string;
  goAnalysis: (text?: string, inputs?: any[]) => void;
}

const getInitData = () => {
  let conversationCode = uuidV4()
  //console.log(conversationCode)
  let list = [
    {
      key: conversationCode,
      label: '新会话',
      group: '今天',
      messages: []
    }
  ]
  return {
    conversationCode,
    list
  }
}

const AIAnalysisComponent: ForwardRefRenderFunction<AIAnalysisComponentAction, AIAnalysisComponentProps> = (props, ref) => {
  const {sourceText, literatureInfo} = props
  const {styles} = useCopilotStyle()
  const attachmentsRef = useRef<GetRef<typeof Attachments>>(null)
  const [messageHistory, setMessageHistory] = useState<Record<string, any>>({})
  const initData = getInitData()
  const {
    conversations,
    activeConversationKey,
    setActiveConversationKey,
    addConversation,
    getConversation,
    setConversation,
    setConversations
  } = useXConversations({
    defaultConversations: initData.list,
    defaultActiveConversationKey: initData.conversationCode,
  })

  const [attachmentsOpen, setAttachmentsOpen] = useState(false)
  const [files, setFiles] = useState<GetProp<AttachmentsProps, 'items'>>([])

  const [inputValue, setInputValue] = useState('')

  const [ragStatus, setRagStatus] = useState(literatureInfo?.ragStatus || 0)
  const {message} = App.useApp()
  const {token} = useToken()
  const downloadLinkRef = useRef<HTMLAnchorElement>(null)

  useInterval(
    async () => {
      let ret = await checkResLiterature(literatureInfo.resCode)
      setRagStatus(ret?.data?.ragStatus || 0)
    },
    // Delay in milliseconds or null to stop it
    [0, 1].includes(ragStatus) ? 5000 : null,
  )

  const exportChatListToWord = () => {
    let htmlList = document.querySelectorAll('#ai-chat-list .ant-bubble-content')

    if (!htmlList?.length || !downloadLinkRef.current) return

    let parts: string[] = []
    htmlList.forEach((_: Element) => {
      parts.unshift(_.innerHTML)
    })
    let conversation = getConversation(activeConversationKey)
    // Create download URL and trigger download
    const htmlString = `<!DOCTYPE html>
    <html lang='en'>
        <head>
            <meta charset='utf-8'>
            <title>${conversation?.label}</title>
        </head>
        <body>
            <h1 style='text-align: center'>${conversation?.label}</h1>
            ${parts.join('\r\n')}
        </body>
    </html>`
    const url = URL.createObjectURL(new Blob(['\ufeff', htmlString], {type: 'text/html'}))

    // Use the ref to trigger download
    downloadLinkRef.current.href = url
    downloadLinkRef.current.download = `${conversation?.label}.doc`
    downloadLinkRef.current.click()
  }

  const reloadMessageList = async (conversationCode: string) => {
    let list = (await getMessageList(1, 20, {conversationCode})).rows || []
    let msgList: React.SetStateAction<MessageInfo<LiteratureChatMessage>[]> = []
    list.forEach((_: any) => {
      msgList.unshift({
        message: {
          role: 'assistant',
          content: _.answer,
        },
        id: `${_.messageCode}-answer`,
        status: 'success',
        extraInfo: {
          messageCode: _.messageCode,
          answerFeedback: _.answerFeedback
        }
      })
      let queryContent = _.inputs || []
      queryContent.push({type: 'text', text: _.query})
      msgList.unshift({
        message: {
          role: 'user',
          content: queryContent,
        },
        id: `${_.messageCode}-query`,
        status: 'success'
      })
    })

    setMessageHistory((prev) => ({
      ...prev,
      [conversationCode]: msgList,
    }))
    return msgList
  }

  const loadConversationList = async () => {
    if (!literatureInfo?.resCode) {
      return
    }
    let list = (await getConversationList(1, 100, {
      channel: 'pdfviewer_literature',
      channelGroup: literatureInfo.resCode
    })).rows || []
    if (!list.length) {
      return
    }

    setConversations(list.map((_: any) => {
      let today = new Date(dayjs().format('YYYY-MM-DD'))
      let yesterday = dayjs(today).add(-1, 'days').toDate()
      let group = '更早'
      let updateTime = new Date(_.updateTime)
      /*console.log(_, updateTime, today, yesterday)*/
      if (updateTime >= today) {
        group = '今天'
      } else if (updateTime >= yesterday) {
        group = '昨天'
      }
      return {
        key: _.conversationCode,
        label: _.title,
        group,
        messages: []
      }
    }))
    await reloadMessageList(list[0].conversationCode)
    setTimeout(() => {
      setActiveConversationKey(list[0].conversationCode)
    }, 100)
  }

  useEffect(() => {
    loadConversationList()
  }, [literatureInfo])

  useEffect(() => {
  }, [sourceText])

  useImperativeHandle(ref, () => ({
    getAIAnalysisStatus: () => {
      return isRequesting ? 'loading' : 'none'
    },
    goAnalysis: (query?: string, inputs?: any[]) => {
      if (!query) {
        return
      }
      if (isRequesting) {
        message.error('解读正在进行中，请稍后再试。')
        return
      }
      handleUserSubmit(query, inputs)
    }
  }))

  // ==================== Runtime ====================

  // @ts-ignore
  const llmChatRequest = XRequest<LiteratureChatInput, LiteratureChatOutput>(`${LLM_API_BASE}/core/chat/stream`, {
    manual: true,
    fetch: async (baseURL, options = {}) => {
      let headers: any = {}
      headers['param-accessToken'] = getAccessToken()
      if (process.env.NODE_ENV === 'development') {
        let userStr: string = getUserCache(false)
        userStr && (headers['user-info'] = userStr)
      }
      return await fetch(baseURL, {
        ...options,
        headers: {
          ...headers,
          ...options.headers // 保留原始 headers
        },
      })
    }
  })

  const providerCaches = new Map<string, LiteratureChatProvider>()
  const providerFactory = (conversationKey: string) => {
    if (!providerCaches.get(conversationKey)) {
      providerCaches.set(
        conversationKey,
        new LiteratureChatProvider({
          request: llmChatRequest,
        }),
      )
    }
    return providerCaches.get(conversationKey)
  }

  const getDefaultMessages = (conversationKey: string) => {
    let messages = messageHistory[conversationKey] || []
    //console.log(2, conversationKey, messages)
    return messages
  }

  const {messages, onRequest, setMessages, isRequesting, abort} = useXChat({
    conversationKey: activeConversationKey,
    provider: providerFactory(activeConversationKey),
    defaultMessages: getDefaultMessages(activeConversationKey),
    requestFallback: (_, {error, messageInfo}) => {
      //console.log(error, messageInfo)
      if (error.name === 'AbortError') {
        return {
          content: '请求已取消',
          role: 'assistant',
        } as LiteratureChatMessage
      }
      return {
        content: '请求失败 ，请稍后重试!',
        role: 'assistant',
      } as LiteratureChatMessage
    },
    requestPlaceholder: () => {
      return {
        content: '正在处理，请稍后。。。',
        role: 'assistant',
      } as LiteratureChatMessage
    },
  })

  // ==================== Event ====================
  const handleUserSubmit = async (val: string, inputs: any[] = []) => {
    let cacheParams: any = {}
    if (canCacheQueryMap[val]) {
      cacheParams.cache = 1
      cacheParams.channelCacheKey = literatureInfo.originalHashCode || literatureInfo.originalResCode || literatureInfo.resCode
    }
    let messageCode = uuidV4()
    onRequest({
      messages: [{content: inputs.concat([{type: 'text', text: val}]), role: 'user'}],
      conversationCode: activeConversationKey,
      query: val,
      options: {
        channel: 'pdfviewer_literature',
        channelGroup: literatureInfo.resCode,
        ragParams: {resCode: literatureInfo.resCode},
        inputs,
        ...cacheParams,
        messageCode
      },
    }, {extraInfo: {messageCode, answerFeedback: 0}})

    // session title mock
    const conversation = getConversation(activeConversationKey)
    if (conversation?.label === '新会话') {
      setConversation(activeConversationKey, {...conversation, label: val?.slice(0, 20)})
    }
  }

  const onPasteFile = (files: FileList) => {
    for (const file of files) {
      attachmentsRef.current?.upload(file)
    }
    setAttachmentsOpen(true)
  }

  // ==================== Nodes ====================
  const chatHeader = (
    <div className={styles.chatHeader}>
      <div className={styles.headerTitle}>✨ AI文献助手</div>
      <Space size={0}>
        <Button
          type='text'
          icon={<PlusOutlined/>}
          onClick={() => {
            if (isRequesting) {
              message.error(
                '请求正在处理中，请您等待处理完成再创建新的会话；如果想立即创建信息的会话，请先取消当前请求。',
              )
              return
            }

            if (messages?.length) {
              let newConversation = conversations.find((i) => i.label === '新会话')
              if (newConversation) {
                setActiveConversationKey(newConversation.key)
                return
              }

              const key = uuidV4()
              isRequesting && abort()
              addConversation({key: key, label: '新会话', group: '今天', messages: []}, 'prepend')
              setActiveConversationKey(key)
            } else {
              message.error('当前已是新会话，无需再次创建。')
            }
          }}
          className={styles.headerButton}
        />
        <Popover
          placement='bottom'
          styles={{container: {padding: 0, maxHeight: 600}}}
          content={
            <Conversations
              items={conversations?.map((i) =>
                i.key === activeConversationKey ? {...i, label: `[当前会话] ${i.label}`} : i,
              )}
              activeKey={activeConversationKey}
              groupable
              onActiveChange={async (val) => {
                isRequesting && abort()

                let msgList = messageHistory?.[val]
                if (!msgList?.length) {
                  msgList = await reloadMessageList(val)
                }
                setTimeout(() => {
                  setActiveConversationKey(val)
                }, 100)
              }}
              styles={{item: {padding: '0 8px'}}}
              className={styles.conversations}
            />
          }
        >
          <Button type='text' icon={<CommentOutlined/>} className={styles.headerButton}/>
        </Popover>
      </Space>
    </div>
  )

  const chatList = (
    <div id='ai-chat-list' className={styles.chatList}>
      {messages?.length ? (
        /** 消息列表 */
        <Bubble.List
          style={{height: '100%'}}
          // @ts-ignore
          items={messages?.map((i) => ({
            ...i.message,
            id: `msg-${i.id}`,
            key: i.id,
            classNames: {
              content: i.status === 'loading' ? styles.loadingMessage : '',
            },
            typing: i.status === 'loading' ? {step: 5, interval: 20, suffix: <>✨</>} : false,
            contentRender: (content, info) => {
              if (typeof content === 'string') {
                return renderMarkdown(content, info)
              } else if (isArray(content) && content.length) {
                return content.map((item: any, index: number) => {
                  if (item.type === 'text') {
                    return <div key={index}>{renderMarkdown(item.text, info)}</div>
                  } else if (item.type === 'image_url') {
                    return <div key={index}><img src={item.image_url.url} alt=''/></div>
                  }
                  return null
                })
              }
              return ''
            }
          }))}
          role={{
            assistant: {
              placement: 'start',
              footer: (content, info) => {
                let msgInfo = messages.find(_ => _.id === info.key)
                return (
                  <div style={{display: 'flex'}}>
                    <Tooltip title='复制后粘贴到word文档中'>
                      <Button
                        type='text' size='small' icon={<CopyWordIcon size={16}/>}
                        onClick={() => {
                          //console.log(document.querySelector(`#msg-${info.key} .ant-bubble-content`)?.innerHTML, info)
                          const type = 'text/html'
                          // @ts-ignore
                          const blob = new Blob([document.querySelector(`#msg-${info.key} .ant-bubble-content`)?.innerHTML], {type})
                          const data = [new ClipboardItem({[type]: blob})]
                          navigator.clipboard.write(data).then(() => {
                            message.success('已复制')
                          })
                            .catch(err => {
                              console.error(err)
                              message.error(`复制失败${err?.message ? '：' + err.message : ''}`)
                            })
                        }}
                      />
                    </Tooltip>
                    <Tooltip title='纯文本复制'>
                      <Button
                        type='text' size='small' icon={<CopyOutlined/>}
                        onClick={() => {
                          //console.log(document.querySelector(`#msg-${info.key} .ant-bubble-content`)?.innerHTML, info)
                          const type = 'text/plain'
                          // @ts-ignore
                          const blob = new Blob([document.querySelector(`#msg-${info.key} .ant-bubble-content`)?.innerText], {type})
                          const data = [new ClipboardItem({[type]: blob})]
                          navigator.clipboard.write(data).then(() => {
                            message.success('已复制')
                          })
                            .catch(err => {
                              console.error(err)
                              message.error(`复制失败${err?.message ? '：' + err.message : ''}`)
                            })
                        }}
                      />
                    </Tooltip>
                    <Button
                      type='text' size='small' icon={<LikeOutlined/>}
                      style={{color: msgInfo?.extraInfo?.answerFeedback === 1 ? token.colorWarning : ''}}
                      disabled={!msgInfo}
                      onClick={() => {
                        console.log(messages)
                        let messageCode = msgInfo?.message?.messageCode || msgInfo?.extraInfo?.messageCode
                        if (!msgInfo || !messageCode) {
                          return
                        }
                        msgInfo.extraInfo = msgInfo.extraInfo || {messageCode, answerFeedback: 0}
                        if (msgInfo.extraInfo.answerFeedback === 1) {
                          msgInfo.extraInfo.answerFeedback = 0
                        } else {
                          msgInfo.extraInfo.answerFeedback = 1
                        }
                        setMessages([...messages])
                        setMessageHistory((prev) => ({
                          ...prev,
                          [activeConversationKey]: [...messages],
                        }))
                        feedback(msgInfo.extraInfo.messageCode, msgInfo.extraInfo.answerFeedback)
                      }}
                    />
                    <Button
                      type='text' size='small' icon={<DislikeOutlined/>}
                      style={{color: msgInfo?.extraInfo?.answerFeedback === -1 ? token.colorWarning : ''}}
                      disabled={!msgInfo}
                      onClick={() => {
                        let messageCode = msgInfo?.message?.messageCode || msgInfo?.extraInfo?.messageCode
                        if (!msgInfo || !messageCode) {
                          return
                        }
                        msgInfo.extraInfo = msgInfo.extraInfo || {messageCode, answerFeedback: 0}
                        if (msgInfo.extraInfo.answerFeedback === -1) {
                          msgInfo.extraInfo.answerFeedback = 0
                        } else {
                          msgInfo.extraInfo.answerFeedback = -1
                        }
                        setMessages([...messages])
                        setMessageHistory((prev) => ({
                          ...prev,
                          [activeConversationKey]: [...messages],
                        }))
                        feedback(msgInfo.extraInfo.messageCode, msgInfo.extraInfo.answerFeedback)
                      }}
                    />
                    <label><Typography.Text type='secondary'>以上内容由AI生成，请注意甄别。</Typography.Text></label>
                  </div>
                )
              },
              loadingRender: () => (
                <Space>
                  <Spin size='small'/>
                  {AGENT_PLACEHOLDER}
                </Space>
              ),
            },
            user: {placement: 'end'},
          }}
        />
      ) : (
        /** 没有消息时的 welcome */
        <>
          <Welcome
            variant='borderless'
            title='👋 你好，我是文献助手'
            description=''
            className={styles.chatWelcome}
          />

          <Prompts
            vertical
            title='我可以帮你：'
            items={MOCK_QUESTIONS.map((i) => ({key: i, description: i}))}
            onItemClick={(info) => handleUserSubmit(info?.data?.description as string)}
            style={{}}
            styles={{
              title: {fontSize: 14},
            }}
          />
        </>
      )}
    </div>
  )
  const sendHeader = (
    <Sender.Header
      title='上传文件'
      styles={{content: {padding: 0}}}
      open={attachmentsOpen}
      onOpenChange={setAttachmentsOpen}
      forceRender
    >
      <Attachments
        ref={attachmentsRef}
        beforeUpload={() => false}
        items={files}
        onChange={({fileList}) => setFiles(fileList)}
        placeholder={(type) =>
          type === 'drop'
            ? {title: '把文件拖拽到此处'}
            : {
              icon: <CloudUploadOutlined/>,
              title: '上传文件',
              description: '点击上传或把文件拖拽到此处',
            }
        }
      />
    </Sender.Header>
  )
  const chatSender = (
    <Flex vertical gap={12} className={styles.chatSend}>
      <Flex gap={12} align='center'>
        <Button
          icon={<ScheduleOutlined/>}
          onClick={() => handleUserSubmit('总结核心内容')}
        >
          总结核心内容
        </Button>
        <Button
          icon={<FundViewOutlined/>}
          onClick={() => handleUserSubmit('解析研究方法')}
        >
          解析研究方法
        </Button>
        {
          messages?.length ?
            <Button
              type='link'
              icon={<FileWordFilled/>}
              onClick={() => exportChatListToWord()}
            >
              导出会话内容
            </Button> : null
        }
      </Flex>

      {/** 输入框 */}
      <Suggestion items={MOCK_SUGGESTIONS} onSelect={(itemVal) => setInputValue(itemVal)}>
        {({onTrigger, onKeyDown}) => (
          <Sender
            loading={isRequesting}
            value={inputValue}
            onChange={(v) => {
              onTrigger(v === '/')
              setInputValue(v)
            }}
            onSubmit={() => {
              handleUserSubmit(inputValue)
              setInputValue('')
            }}
            onCancel={async () => {
              isRequesting && abort()
            }}
            allowSpeech
            placeholder='请提出您的问题，输入/查看建议问题'
            onKeyDown={onKeyDown}
            /*header={sendHeader}
            prefix={
              <Button
                type="text"
                icon={<PaperClipOutlined style={{ fontSize: 18 }} />}
                onClick={() => setAttachmentsOpen(!attachmentsOpen)}
              />
            }*/
            onPasteFile={onPasteFile}
          />
        )}
      </Suggestion>
    </Flex>
  )

  useEffect(() => {
    // history mock
    if (messages?.length) {
      setMessageHistory((prev) => ({
        ...prev,
        [activeConversationKey]: messages,
      }))
    }
  }, [messages])

  if ([0, 1].includes(ragStatus)) {
    return (
      <Spin tip='处理中。。。'>
        <Alert
          style={{margin: '50px'}}
          title='文献资料正在解析，稍后解读'
          description='文献资料正在解析，您可以先阅读文献原文、添加批注标记等，稍后再来使用AI帮助解读。'
          type='info'
        />
      </Spin>
    )
  } else if (ragStatus < 0) {
    return (
      <Result
        status='500'
        title='文献解析出错'
        subTitle='抱歉，文献资料解析出错，无法为您解读。'
        extra={<Button type='primary' onClick={() => history.push('/')}>回到首页</Button>}
      />
    )
  }

  return (
    <XProvider locale={{...zhCN_X, ...zhCN}}>
      <div className={styles.copilotChat}>
        {/** 对话区 - header */}
        {chatHeader}

        {/** 对话区 - 消息列表 */}
        {chatList}

        {/** 对话区 - 输入框 */}
        {chatSender}
      </div>

      {/* Hidden download link */}
      <a ref={downloadLinkRef} style={{display: 'none'}} href='' download=''/>
    </XProvider>
  )
}

export default React.forwardRef(AIAnalysisComponent)
