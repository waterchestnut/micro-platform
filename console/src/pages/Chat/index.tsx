import {useState, useRef, useMemo, useEffect, useCallback} from 'react'
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
} from 'antd'
import {createStyles} from 'antd-style'
import {
  Bubble,
  Sender,
  Think,
  Sources,
  XProvider,
  BubbleListProps,
  Attachments,
  type AttachmentsProps,
  ThoughtChain,
  type ThoughtChainItemType,
  FileCardProps,
  FileCard,
  BubbleProps,
} from '@ant-design/x'
import {
  CloudUploadOutlined,
  CodeOutlined,
  EditOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons'
import {type ComponentProps, XMarkdown} from '@ant-design/x-markdown'
import Latex from '@ant-design/x-markdown/plugins/Latex'
import {UserOutlined, RobotOutlined, MessageOutlined, LinkOutlined} from '@ant-design/icons'
import zhCN from 'antd/locale/zh_CN'
import zhCN_X from '@ant-design/x/locale/zh_CN'
import ThinkComponent from '@/pages/Chat/components/ThinkComponent'
import CodeComponent from '@/pages/Chat/components/CodeComponent'
import {getSupComponent} from '@/pages/Chat/components/SupComponent'
import ConversationList, {type Conversation} from '@/pages/Chat/components/ConversationList'
import {getAccessToken, getUserCache} from '@/utils/authority'
import CommonChatProvider, {
  CommonChatInput,
  CommonChatMessage,
  CommonChatOutput,
} from '@/chatProviders/CommonChatProvider'
import {MessageInfo, useXChat, XRequest} from '@ant-design/x-sdk'
import {getMessageList} from '@/services/llm/message'
import {getConversationList} from '@/services/llm/conversation'
import dayjs from 'dayjs'
import {isArray, uuidV4} from '@/utils/util'

type AttachmentItem = GetProp<AttachmentsProps, 'items'>[number];

const useStyles = createStyles(({token, css}) => ({
  container: css`
    height: 100%;
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

const Index: React.FC = () => {
  const {token} = theme.useToken()
  const {styles} = useStyles()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConv, setActiveConv] = useState<string>('')
  const [inputValue, setInputValue] = useState('')
  const [attachmentsOpen, setAttachmentsOpen] = useState(false)
  const [attachmentItems, setAttachmentItems] = useState<AttachmentItem[]>([])
  const [recording, setRecording] = useState(false)
  const listRef = useRef<any>(null)
  const senderRef = useRef<GetRef<typeof Sender>>(null)
  const [messageHistory, setMessageHistory] = useState<Record<string, any>>({})

  const reloadMessageList = async (conversationCode: string) => {
    let list = (await getMessageList(1, 20, {conversationCode})).rows || []
    let msgList: React.SetStateAction<MessageInfo<CommonChatMessage>[]> = []
    list.forEach((_: any) => {
      msgList.unshift({
        message: {
          role: 'ai',
          content: `${_.answer}`,
          messageCode: _.messageCode,
          attachments: _.answerAttachments,
          answerFeedback: _.answerFeedback,
          answerReasoning: _.answerReasoning,
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

  const loadConversationList = async () => {
    let list =
      (
        await getConversationList(1, 20, {
          channel: 'xxzx_common',
        })
      ).rows || []
    if (!list.length) {
      let newKey = uuidV4()
      setConversations([
        {
          key: newKey,
          label: '新会话',
          group: '今天',
        },
      ])
      setActiveConv(newKey)
      return
    }

    setConversations(
      list.map((_: any) => {
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
        }
      }),
    )
    await reloadMessageList(list[0].conversationCode)
    setActiveConv(list[0].conversationCode)
  }

  useEffect(() => {
    loadConversationList()
  }, [])

  const llmChatRequest = XRequest<CommonChatInput, CommonChatOutput>(
    // @ts-ignore
    `${LLM_API_BASE}/core/chat/stream`,
    {
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
            ...options.headers, // 保留原始 headers
          },
        })
      },
    },
  )

  const providerCaches = new Map<string, CommonChatProvider>()
  const providerFactory = (conversationKey: string) => {
    if (!providerCaches.get(conversationKey)) {
      providerCaches.set(
        conversationKey,
        new CommonChatProvider({
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
    conversationKey: activeConv,
    provider: providerFactory(activeConv),
    defaultMessages: getDefaultMessages(activeConv),
    requestFallback: (_, {error, messageInfo}) => {
      //console.log(error, messageInfo)
      if (error.name === 'AbortError') {
        return {
          content: '请求已取消',
          role: 'ai',
        } as CommonChatMessage
      }
      return {
        content: '请求失败 ，请稍后重试!',
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

  useEffect(() => {
    return () => {
      attachmentItems.forEach((item) => {
        if (item.url?.startsWith('blob:')) {
          URL.revokeObjectURL(item.url)
        }
      })
    }
  }, [attachmentItems])

  const handleSend = useCallback(
    async (content: string) => {
      if (!content.trim() && attachmentItems.length === 0) return

      let messageCode = uuidV4()
      let inputs: any[] = attachmentItems.map((item) => ({
        type: item.type + '_url',
        [item.type + '_url']: {url: item.url},
      }))
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
            channel: 'xxzx_common',
            inputs,
            messageCode,
            attachments: attachmentItems,
          },
        },
        {extraInfo: {}},
      )

      const conversation = conversations.find((_) => _.key === activeConv)
      if (conversation?.label === '新会话') {
        conversation.label = content?.slice(0, 20)
        setConversations([...conversations])
      }

      setInputValue('')
      setAttachmentItems([])
      setAttachmentsOpen(false)
    },
    [attachmentItems, activeConv, conversations],
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
      return
    }

    if (messageHistory[activeConv]?.length) {
      let newConversation = conversations.find((i) => i.label === '新会话')
      if (newConversation) {
        setActiveConv(newConversation.key)
        return
      }

      const key = uuidV4()
      isRequesting && abort()
      setConversations([{key: key, label: '新会话', group: '今天'}, ...conversations])
      setMessageHistory((prev) => ({...prev, [key]: []}))
      setActiveConv(key)
    } else {
      message.error('当前已是新会话，无需再次创建。')
    }
  }, [messageHistory])

  const handleAttachmentsChange: AttachmentsProps['onChange'] = ({file, fileList}) => {
    const updatedFileList = fileList.map((item) => {
      if (item.uid === file.uid && file.status !== 'removed' && item.originFileObj) {
        if (item.url?.startsWith('blob:')) {
          URL.revokeObjectURL(item.url)
        }
        return {
          ...item,
          url: URL.createObjectURL(item.originFileObj),
        }
      }
      return item
    })
    setAttachmentItems(updatedFileList)
  }

  const renderThoughtChain = ({children}: ComponentProps) => {
    const steps: ThoughtChainItemType[] = [
      {
        key: '1',
        title: '分析问题',
        description: '理解用户问题并分析需求',
        icon: <CodeOutlined/>,
        collapsible: true,
        content: (
          <Flex gap='small' vertical>
            <Think title='思考过程'>{children}</Think>
          </Flex>
        ),
      },
      {
        key: '2',
        title: '生成答案',
        description: '根据分析结果生成回答',
        icon: <EditOutlined/>,
        collapsible: true,
        status: 'success',
        content: (
          <Flex gap='small' vertical>
            <ThoughtChain.Item
              variant='solid'
              status='success'
              title='答案生成完成'
              description='已为用户提供完整解答'
            />
          </Flex>
        ),
      },
    ]
    return <ThoughtChain items={steps} line='dashed'/>
  }

  const sourceItems = [
    {
      title: '1. Data source',
      key: 1,
      url: 'https://x.ant.design/components/overview',
      description:
        'Artificial Intelligence, often abbreviated as AI, is a broad branch of computer science concerned with building smart machines capable of performing tasks that typically require human intelligence.',
    },
    {
      title: '2. Data source',
      key: 2,
      url: 'https://x.ant.design/components/overview',
    },
    {
      title: '3. Data source',
      key: 3,
      url: 'https://x.ant.design/components/overview',
    },
  ]

  const items: BubbleListProps['items'] = useMemo(
    () =>
      messages.map((item) => ({
        key: item.id,
        role: item.message.role,
        content: item.message.content,
        loading:
          item.message.role === 'ai' &&
          isRequesting &&
          item.id === messages[messages.length - 1]?.id,
        status: item.status,
        extraInfo: {...item.extraInfo, ...item.message},
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
            sup: getSupComponent(sourceItems),
            thoughtchain: renderThoughtChain,
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
                  sup: getSupComponent(sourceItems),
                  thoughtchain: renderThoughtChain,
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
        return {
          typing: true,
          header: answerReasoning ? (
            <Think
              defaultExpanded={!data.content}
              styles={{content: {maxHeight: '300px', overflow: 'auto'}}}
              title={data.content ? '思考过程' : '思考中'}
            >
              <XMarkdown content={answerReasoning}/>
            </Think>
          ) : null,
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
          footer: (content, info) => {
            return (
              <div style={{display: 'flex'}}>
                <label>
                  <Typography.Text type='secondary'>以上内容由AI生成，请注意甄别。</Typography.Text>
                </label>
              </div>
            )
          },
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
        beforeUpload={() => false}
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
          conversations={conversations}
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
              allowSpeech={{
                recording,
                onRecordingChange: (nextRecording) => {
                  message.info(`语音输入：${nextRecording ? '开始录音' : '停止录音'}`)
                  setRecording(nextRecording)
                },
              }}
              className={styles.messageContainer}
            />
          </div>
        </div>
      </Flex>
    </XProvider>
  )
}

export default Index
