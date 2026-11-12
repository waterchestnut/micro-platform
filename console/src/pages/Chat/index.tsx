import {useState, useRef, useMemo, useEffect, useCallback, createRef} from 'react'
import {
  Flex,
  Avatar,
  Button,
  theme,
  message,
  Badge,
  type GetProp,
  type GetRef,
  Typography,
  Spin,
  Space,
  Upload,
} from 'antd'
import {createStyles} from 'antd-style'
import {
  Bubble,
  Sender,
  Think,
  XProvider,
  BubbleListProps,
  Attachments,
  type AttachmentsProps,
  FileCardProps,
  FileCard,
  BubbleProps,
} from '@ant-design/x'
import {CloudUploadOutlined} from '@ant-design/icons'
import {XMarkdown} from '@ant-design/x-markdown'
import Latex from '@ant-design/x-markdown/plugins/Latex'
import {UserOutlined, RobotOutlined, MessageOutlined, LinkOutlined} from '@ant-design/icons'
import zhCN from 'antd/locale/zh_CN'
import zhCN_X from '@ant-design/x/locale/zh_CN'
import ThinkComponent from '@/pages/Chat/components/ThinkComponent'
import CodeComponent from '@/pages/Chat/components/CodeComponent'
import ConversationList, {
  type Conversation,
  ConversationListAction,
} from '@/pages/Chat/components/ConversationList'
import {getAccessToken, getUserCache} from '@/utils/authority'
import CommonChatProvider, {
  CHANNEL_COMMON,
  asText,
  type CommonChatInput,
  type CommonChatMessage,
  type CommonChatOutput,
} from '@/chatProviders/CommonChatProvider'
import {MessageInfo, useXChat, XRequest} from '@ant-design/x-sdk'
import {getMessageList} from '@/services/llm/message'
import ProcessPanel from '@/pages/Chat/components/ProcessPanel'
import EmptyRoundNotice from '@/pages/Chat/components/EmptyRoundNotice'
import {fromHistorySegments} from '@/chatProviders/segments'
import {makeToolResultLoader} from '@/services/llm/toolResultClient'
import {formatUploadFile, getDocHttpUrl, isArray, uuidV4} from '@/utils/util'

type AttachmentItem = GetProp<AttachmentsProps, 'items'>[number];

const useStyles = createStyles(({token, css}) => ({
  container: css`
    height: calc(100vh - 64px);
    background-color: ${token.colorBgLayout};
  `,
  main: css`
    flex: 1;
    display: flex;
    flex-direction: column;
  `,
  messageList: css`
    flex: 1;
    overflow: auto;
    padding: 24px;
  `,
  messageContainer: css`
    max-width: 1200px;
    margin: 0 auto;

    .ant-bubble-start .ant-bubble-body {
      width: 100%;
    }
  `,
  inputArea: css`
    padding: 16px 24px;
    background-color: ${token.colorBgContainer};
    border-top: 1px solid ${token.colorBorder};
  `,
}))

/**
 * 取凭据的写法全页只有一份。
 *
 * 之所以在这里立一个函数而不是再抄一遍：`/core/message/tool-result` 的取回与 SSE 流用的是
 * **同一套凭据**，两处各写一次就意味着"其中一处改了而另一处没改"这种故障。
 * 语义与原先内联实现逐字相同：`param-accessToken` 恒发，dev 环境额外带 `user-info`。
 */
const buildAuthHeaders = (): Record<string, string> => {
  const headers: any = {}
  headers['param-accessToken'] = getAccessToken()
  if (process.env.NODE_ENV === 'development') {
    const userStr: string = getUserCache(false)
    userStr && (headers['user-info'] = userStr)
  }
  return headers
}

const providerCaches = new Map<string, CommonChatProvider>()
const providerFactory = (conversationKey: string) => {
  if (!providerCaches.get(conversationKey)) {
    providerCaches.set(
      conversationKey,
      new CommonChatProvider({
        request: XRequest<CommonChatInput, CommonChatOutput>(
          // @ts-ignore
          `${LLM_API_BASE}/core/chat/stream`,
          {
            manual: true,
            fetch: async (baseURL, options = {}) => {
              return await fetch(baseURL, {
                ...options,
                headers: {
                  ...buildAuthHeaders(),
                  ...options.headers, // 保留原始 headers
                },
              })
            },
          },
        ),
      }),
    )
  }
  return providerCaches.get(conversationKey)
}

const Index: React.FC = () => {
  const {token} = theme.useToken()
  const {styles} = useStyles()
  const [activeConv, setActiveConv] = useState<string>('')
  const [inputValue, setInputValue] = useState('')
  const [attachmentsOpen, setAttachmentsOpen] = useState(false)
  const [attachmentItems, setAttachmentItems] = useState<AttachmentItem[]>([])
  const [recording, setRecording] = useState(false)
  const listRef = useRef<any>(null)
  const senderRef = useRef<GetRef<typeof Sender>>(null)
  const conversationListRef = createRef<ConversationListAction>()
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const [messageHistory, setMessageHistory] = useState<Record<string, any>>({})
  const [speechSupported, setSpeechSupported] = useState(false)
  const [speechNetworkError, setSpeechNetworkError] = useState(false)

  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      setSpeechSupported(false)
      return
    }
    setSpeechSupported(true)

    const testRecognition = new SpeechRecognition()
    testRecognition.lang = 'zh-CN'
    testRecognition.continuous = true
    testRecognition.interimResults = true

    testRecognition.onerror = (event: any) => {
      if (event.error === 'network') {
        setSpeechNetworkError(true)
      }
    }

    testRecognition.onend = () => {
    }

    try {
      testRecognition.start()
      setTimeout(() => testRecognition.stop(), 1000)
    } catch (e) {
      setSpeechNetworkError(true)
    }
  }, [])

  const reloadMessageList = async (conversationCode: string) => {
    let list = (await getMessageList(1, 20, {conversationCode})).rows || []
    let msgList: React.SetStateAction<MessageInfo<CommonChatMessage>[]> = []
    list.forEach((_: any) => {
      msgList.unshift({
        message: {
          role: 'ai',
          /**
           * 原先是 `${_.answer}`：answer 缺失的行会渲染出字面量 "undefined"（本轮没有正文时就是这个形状，
           * 而"没有正文"恰恰是 EmptyRoundNotice 要解释的那一类，不能先被字符串模板糊掉）。
           */
          content: _.answer ?? '',
          messageCode: _.messageCode,
          attachments: _.answerAttachments,
          answerFeedback: _.answerFeedback,
          answerReasoning: _.answerReasoning,
          // 协议 3 展示视图（message/list 的 process/progress）→ 历史回放同样带过程面板与分段
          fromCache: !!_.answerFromCache,
          process: _.process,
          sources: _.process?.sources || [],
          toolCalls: (_.process?.toolCalls || []).map((t: any) => ({...t, status: 'done'})),
          /** 历史行的段：库里的 `process.segments` 是权威副本，形状在这里归一，组件只消费 */
          segments: fromHistorySegments(_.process?.segments),
          streamState: _.progress === 'abort' ? 'aborted' : _.progress === 'error' ? 'error' : 'done',
          /**
           * `error` 两种进度都要带：`abandoned:` 前缀是判断"这轮是被服务重启打断的"唯一凭据，
           * 只给 error 行的话，回填行的空正文就只能显示成"内容不完整"那种含糊话。
           */
          errorText: _.progress === 'error' || _.progress === 'abort' ? _.error : undefined,
        },
        id: `${_.messageCode}-answer`,
        status: 'success',
        extraInfo: {},
      })
      let queryContent = _.inputs || []
      queryContent.push({type: 'text', text: _.query})
      msgList.unshift({
        message: {
          role: 'my',
          content: queryContent,
          messageCode: _.messageCode,
          attachments: _.attachments,
        },
        id: `${_.messageCode}-query`,
        status: 'success',
        extraInfo: {},
      })
    })

    setMessageHistory((prev) => ({
      ...prev,
      [conversationCode]: msgList,
    }))
    return msgList
  }

  const getDefaultMessages = (conversationKey: string) => {
    let messages = messageHistory[conversationKey] || []
    //console.log(2, conversationKey, messages)
    return messages
  }

  const {messages, onRequest, setMessages, isRequesting, abort} = useXChat({
    conversationKey: activeConv,
    provider: providerFactory(activeConv),
    defaultMessages: getDefaultMessages(activeConv),
    requestFallback: (_, {error, messageInfo}) => {
      //console.log(error, messageInfo)
      if (error.name === 'AbortError') {
        return {
          ...messageInfo.message,
          role: 'ai',
          streamState: 'aborted',
        } as CommonChatMessage
      }
      return {
        ...messageInfo.message,
        content: messageInfo.message?.content || '',
        errorText: '请求失败 请稍后再试!',
        streamState: 'error',
        role: 'ai',
      } as CommonChatMessage
    },
    requestPlaceholder: () => {
      return {
        content: '正在处理，请稍后。。。',
        role: 'ai',
      } as CommonChatMessage
    },
  })

  const handleSend = useCallback(
    async (content: string) => {
      if (!content.trim() && attachmentItems.length === 0) return

      let messageCode = uuidV4()
      let inputs: any[] = []
      onRequest(
        {
          messages: [
            {
              content: inputs.concat([{type: 'text', text: content}]),
              role: 'my',
              messageCode,
              answerFeedback: 0,
            },
          ],
          conversationCode: activeConv,
          query: content,
          options: {
            channel: CHANNEL_COMMON,
            inputs,
            messageCode,
            attachments: formatUploadFile(attachmentItems).filter((_) => _.status === 'done'),
            enableThinking: 0,
          },
        },
        {extraInfo: {}},
      )

      conversationListRef?.current?.modifyInitLabel(activeConv, content?.slice(0, 20))

      setInputValue('')
      setAttachmentItems([])
      setAttachmentsOpen(false)
    },
    [attachmentItems, activeConv, conversationListRef],
  )

  const handleConversationSelect = async (key: string, item?: any) => {
    isRequesting && abort()

    let msgList = messageHistory?.[key]
    if (!msgList) {
      msgList = await reloadMessageList(key)
    }
    setActiveConv(key)
  }

  useEffect(() => {
    // history mock
    if (messages?.length) {
      setMessageHistory((prev) => ({
        ...prev,
        [activeConv]: messages,
      }))
    }
  }, [messages])

  const handleNewConversation = useCallback(() => {
    if (isRequesting) {
      message.error(
        '请求正在处理中，请您等待处理完成再创建新的会话；如果想立即创建信息的会话，请先取消当前请求。',
      )
      return false
    }

    if (messageHistory[activeConv]?.length) {
      let newConversation = conversationListRef?.current?.getConvByLabel('新会话')
      if (newConversation) {
        setActiveConv(newConversation.key)
        return false
      }

      const key = uuidV4()
      isRequesting && abort()
      setMessageHistory((prev) => ({...prev, [key]: []}))
      setActiveConv(key)
      return {key: key, label: '新会话', group: '今天'}
    } else {
      message.error('当前已是新会话，无需再次创建。')
      return false
    }
  }, [messageHistory])

  const MAX_FILE_SIZE = 500 * 1024 * 1024 // 500M

  const validateFile = (file: File): boolean => {
    const allowedExtensions = [
      '.pdf',
      '.doc',
      '.docx',
      '.xls',
      '.xlsx',
      '.html',
      '.htm',
      '.md',
      '.txt',
      '.jpg',
      '.jpeg',
      '.png',
      '.gif',
      '.bmp',
      '.webp',
      '.mp3',
      '.wav',
      '.ogg',
      '.aac',
      '.mp4',
      '.avi',
      '.mov',
      '.wmv',
    ]
    const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'))
    if (!allowedExtensions.includes(ext)) {
      message.error('不支持的文件格式')
      return false
    }
    if (file.size > MAX_FILE_SIZE) {
      message.error('文件大小不能超过500M')
      return false
    }
    return true
  }

  const handleAttachmentsChange: AttachmentsProps['onChange'] = async ({file, fileList}) => {
    //console.log(file, fileList)
    if (file.response?.code) {
      message.error(file.response.msg || '上传失败')
      file.status = 'error'
    }
    const updatedFileList = fileList.map((item) => {
      return item
    })
    setAttachmentItems(updatedFileList)
  }


  const getFileCardType = (file: any) => {
    let type = (file.type || '').split('/')[0]
    if (['image', 'audio', 'video'].includes(type)) {
      return type
    }
    return 'file'
  }

  const items: BubbleListProps['items'] = useMemo(
    () =>
      messages.map((item) => ({
        key: item.id,
        role: item.message.role,
        content: item.message.content,
        loading:
          item.status === 'loading' &&
          isRequesting &&
          item.id === messages[messages.length - 1]?.id,
        status: item.status,
        extraInfo: {...item.extraInfo, ...item.message},
        footer: (content, info) => {
          //console.log(info)
          return (
            <div>
              {info.extraInfo?.attachments?.length ? (
                <FileCard.List items={info.extraInfo.attachments.map((_: any) => ({
                  ..._,
                  type: getFileCardType(_),
                  src: getDocHttpUrl(_.url)
                }))}/>
              ) : null}
              {info.extraInfo?.role === 'ai' ? (
                <div style={{display: 'flex'}}>
                  <label>
                    <Typography.Text type='secondary'>
                      以上内容由AI生成，请注意甄别。
                    </Typography.Text>
                  </label>
                </div>
              ) : null}
            </div>
          )
        },
      })),
    [messages, isRequesting, token.colorSuccess, token.colorPrimary],
  )

  const contentRender: BubbleProps['contentRender'] = (content: any, info) => {
    if (typeof content === 'string') {
      return (
        <XMarkdown
          content={content}
          components={{
            think: ThinkComponent,
            code: CodeComponent,
          }}
          config={{extensions: Latex()}}
          paragraphTag='div'
          protectCustomTagNewlines
        />
      )
    } else if (isArray(content) && content.length) {
      return content.map((item: any, index: number) => {
        if (item.type === 'text') {
          return (
            <div key={index}>
              <XMarkdown
                content={item.text as string}
                components={{
                  think: ThinkComponent,
                  code: CodeComponent,
                }}
                config={{extensions: Latex()}}
                paragraphTag='div'
                protectCustomTagNewlines
              />
            </div>
          )
        } else if (item.type === 'image_url') {
          return (
            <div key={index}>
              <img src={item.image_url.url} alt=''/>
            </div>
          )
        }
        return null
      })
    }
    return ''
  }

  const memoRole: BubbleListProps['role'] = useMemo(
    () => ({
      ai: (data) => {
        let answerReasoning = data.extraInfo?.answerReasoning
        const streamState = data.extraInfo?.streamState
        return {
          typing: true,
          header: (
            <Flex vertical gap={4}>
              {answerReasoning ? (
                <Think
                  defaultExpanded={!data.content}
                  styles={{content: {maxHeight: '300px', overflow: 'auto'}}}
                  title={data.content ? '思考续想' : '思考中'}
                >
                  <XMarkdown content={answerReasoning}/>
                </Think>
              ) : null}
              <ProcessPanel
                process={data.extraInfo?.process}
                toolCalls={data.extraInfo?.toolCalls}
                sources={data.extraInfo?.sources}
                fromCache={data.extraInfo?.fromCache}
                segments={data.extraInfo?.segments}
                /**
                 * 取回全文的入口。这里闭包 messageCode 与鉴权头，面板因此既不需要知道 token
                 * 从哪来，也不会出现第二份取 token 的写法（`buildAuthHeaders` 全页只有一份）。
                 * 拿不到 messageCode 就不给函数 ⇒ 按钮不出现：界面不承诺没有入口的动作。
                 */
                toolResultLoader={(call: any) =>
                  call?.id && data.extraInfo?.messageCode
                    ? makeToolResultLoader({
                        // @ts-ignore LLM_API_BASE 是构建期注入的全局
                        url: `${LLM_API_BASE}/core/message/tool-result`,
                        messageCode: data.extraInfo.messageCode,
                        headers: buildAuthHeaders(),
                      })
                    : undefined
                }
              />
              {/*
                空正文的说明按实测分三类给（判据在 segments.ts，用例在 segments.test.ts）：
                被服务重启打断 / 有过程可回放 / 首 token 前就取消。
                原先这里对任何 abort 行都写"内容不完整"——对第 3 类是假的（它根本没产出过内容），
                对第 2 类则是把最有价值的信息（当时做了什么）漏掉了。
              */}
              <EmptyRoundNotice
                content={asText(data.content)}
                segments={data.extraInfo?.segments}
                error={data.extraInfo?.errorText}
                process={data.extraInfo?.process}
                streamState={streamState}
              />
              {streamState === 'error' ? <Typography.Text type='danger'>{data.extraInfo?.errorText || '请求失败，请稍后再试'}</Typography.Text> : null}
            </Flex>
          ),
          contentRender,
          loadingRender: () => (
            <Space>
              <Spin size='small'/>
              {'正在生成内容，敬请等待。。。'}
            </Space>
          ),
          avatar: () => (
            <Avatar icon={<RobotOutlined/>} style={{backgroundColor: token.colorPrimary}}/>
          ),
        }
      },
      user: (data) => ({
        typing: false,
        header: `User-${data.key}`,
        contentRender,
        avatar: () => (
          <Avatar icon={<UserOutlined/>} style={{backgroundColor: token.colorSuccess}}/>
        ),
      }),
      my: (data) => ({
        placement: 'end',
        typing: false,
        header: `我自己`,
        contentRender,
        avatar: () => (
          <Avatar icon={<UserOutlined/>} style={{backgroundColor: token.colorSuccess}}/>
        ),
      }),
      notice: {
        variant: 'filled',
        styles: {
          root: {padding: 0},
          content: {display: 'flex', justifyContent: 'center', alignItems: 'center'},
        },
      },
    }),
    [],
  )

  const senderHeader = (
    <Sender.Header
      title='附件'
      open={attachmentsOpen}
      onOpenChange={setAttachmentsOpen}
      styles={{
        content: {
          padding: 0,
        },
      }}
    >
      <Attachments
        accept='.pdf,.doc,.docx,.xls,.xlsx,.html,.htm,.md,.txt,.jpg,.jpeg,.png,.gif,.bmp,.webp,.mp3,.wav,.ogg,.aac,.mp4,.avi,.mov,.wmv'
        beforeUpload={(file) => validateFile(file) || Upload.LIST_IGNORE}
        // @ts-ignore
        action={DOC_API_BASE + '/file/upload/simple'}
        headers={{'param-accessToken': getAccessToken()}}
        items={attachmentItems}
        onChange={handleAttachmentsChange}
        placeholder={(type) =>
          type === 'drop'
            ? {
              title: '拖拽文件到此处',
            }
            : {
              icon: <CloudUploadOutlined/>,
              title: '上传文件',
              description: '点击或拖拽文件到此处上传',
            }
        }
        getDropContainer={() => senderRef.current?.nativeElement}
      />
    </Sender.Header>
  )

  return (
    <XProvider locale={{...zhCN_X, ...zhCN}}>
      <Flex className={styles.container}>
        <ConversationList
          ref={conversationListRef}
          activeKey={activeConv}
          onConversationSelect={handleConversationSelect}
          onNewConversation={handleNewConversation}
        />

        <div className={styles.main}>
          <div className={styles.messageList}>
            <Bubble.List
              ref={listRef}
              items={items}
              autoScroll
              className={styles.messageContainer}
              role={memoRole}
            />
          </div>
          <div className={styles.inputArea}>
            <Sender
              ref={senderRef}
              loading={isRequesting}
              value={inputValue}
              onChange={setInputValue}
              onSubmit={handleSend}
              onCancel={async () => {
                isRequesting && abort()
              }}
              placeholder='请输入您的问题...'
              header={senderHeader}
              prefix={
                <Badge dot={attachmentItems.length > 0 && !attachmentsOpen}>
                  <Button
                    onClick={() => setAttachmentsOpen(!attachmentsOpen)}
                    icon={<LinkOutlined/>}
                  />
                </Badge>
              }
              allowSpeech={
                speechSupported && !speechNetworkError
                  ? {
                    recording,
                    onRecordingChange: async (nextRecording) => {
                      if (nextRecording) {
                        try {
                          const SpeechRecognition =
                            (window as any).SpeechRecognition ||
                            (window as any).webkitSpeechRecognition
                          if (!SpeechRecognition) {
                            message.error('当前浏览器不支持语音识别功能')
                            return
                          }
                          const recognition = new SpeechRecognition()
                          recognition.lang = 'zh-CN'
                          recognition.continuous = true
                          recognition.interimResults = true

                          let finalTranscript = ''

                          recognition.onresult = (event: any) => {
                            let interimTranscript = ''
                            for (let i = event.resultIndex; i < event.results.length; i++) {
                              const transcript = event.results[i][0].transcript
                              if (event.results[i].isFinal) {
                                finalTranscript += transcript
                              } else {
                                interimTranscript += transcript
                              }
                            }
                            //console.log(finalTranscript, interimTranscript)
                            setInputValue(finalTranscript + interimTranscript)
                          }

                          recognition.onerror = (event: any) => {
                            console.error('语音识别错误:', event.error)
                            if (event.error === 'no-speech') {
                              message.warning('未检测到语音')
                            } else if (event.error === 'not-allowed') {
                              message.error('麦克风权限被拒绝')
                            } else if (event.error === 'network') {
                              message.error('网络连接失败，请检查网络后重试')
                              setSpeechNetworkError(true)
                            } else {
                              message.error('语音识别出错')
                            }
                            setRecording(false)
                          }

                          recognition.onend = () => {
                            //console.log(finalTranscript, 'end')
                            setRecording(false)
                          }

                          recognition.start()
                          mediaRecorderRef.current = recognition as any
                          setRecording(true)
                        } catch (error) {
                          message.error('无法访问麦克风，请检查权限')
                        }
                      } else {
                        if (mediaRecorderRef.current) {
                          mediaRecorderRef.current.stop()
                          setRecording(false)
                        }
                      }
                    },
                  }
                  : false
              }
              className={styles.messageContainer}
            />
          </div>
        </div>
      </Flex>
    </XProvider>
  )
}

export default Index
