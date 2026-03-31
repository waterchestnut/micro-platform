import {useState, useRef, useMemo, useEffect, useCallback} from 'react'
import {Flex, Avatar, Button, theme, message, Badge, type GetProp, type GetRef, Typography, Spin, Space} from 'antd'
import {createStyles} from 'antd-style'
import {
  Bubble,
  Sender,
  Conversations,
  Think,
  Sources,
  XProvider,
  BubbleListProps,
  Attachments,
  type AttachmentsProps,
  ThoughtChain,
  type ThoughtChainItemType, FileCardProps, FileCard
} from '@ant-design/x'
import {CloudUploadOutlined, CodeOutlined, EditOutlined, CheckCircleOutlined} from '@ant-design/icons'
import {type ComponentProps, XMarkdown} from '@ant-design/x-markdown'
import Latex from '@ant-design/x-markdown/plugins/Latex'
import Footer from '@/components/Footer'
import {UserOutlined, RobotOutlined, MessageOutlined, LinkOutlined} from '@ant-design/icons'
import zhCN from 'antd/locale/zh_CN'
import zhCN_X from '@ant-design/x/locale/zh_CN'
import ThinkComponent from '@/pages/Chat/components/ThinkComponent'
import CodeComponent from '@/pages/Chat/components/CodeComponent'
import {getSupComponent} from '@/pages/Chat/components/SupComponent'

interface Conversation {
  key: string;
  label: string;
  icon?: React.ReactNode;
}

interface Message {
  key: string;
  role: 'my' | 'ai' | 'system' | 'user' | 'divider' | 'tip';
  content: string;
  attachments?: AttachmentItem[];
  timestamp?: number;
}

type AttachmentItem = GetProp<AttachmentsProps, 'items'>[number];

const useStyles = createStyles(({token, css}) => {
  return {
    container: css`
      height: 100%;
      background-color: ${token.colorBgLayout};
    `,
    sidebar: css`
      width: 280px;
      border-right: 1px solid ${token.colorBorder};
      background-color: ${token.colorBgContainer};
      display: flex;
      flex-direction: column;
    `,
    sidebarHeader: css`
      padding: 16px;
      border-bottom: 1px solid ${token.colorBorder};
    `,
    sidebarContent: css`
      flex: 1;
      overflow: auto;
    `,
    sidebarFooter: css`
      padding: 12px 16px;
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
  }
})

const Index: React.FC = () => {
  const {token} = theme.useToken()
  const {styles} = useStyles()
  const [conversations, setConversations] = useState<Conversation[]>([
    {key: '1', label: '如何实现快速排序算法？', icon: <MessageOutlined/>},
    {key: '2', label: '解释一下什么是微服务架构', icon: <MessageOutlined/>},
    {key: '3', label: '帮我写一个 Python 脚本', icon: <MessageOutlined/>},
  ])
  const [activeConv, setActiveConv] = useState<string>('1')
  const [messages, setMessages] = useState<Message[]>([
    {
      key: '1',
      role: 'tip',
      content: `# 欢迎使用 AI 助手

我可以帮助你：
- 解答技术问题
- 编写代码
- 解释概念
- 分析数据

请在下方输入你的问题！`,
      timestamp: Date.now(),
    },
    {
      key: '2',
      role: 'divider',
      content: '如何实现快速排序算法？',
      timestamp: Date.now(),
    }
  ])
  const [loading, setLoading] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [attachmentsOpen, setAttachmentsOpen] = useState(false)
  const [attachmentItems, setAttachmentItems] = useState<AttachmentItem[]>([])
  const [recording, setRecording] = useState(false)
  const listRef = useRef<any>(null)
  const senderRef = useRef<GetRef<typeof Sender>>(null)

  useEffect(() => {
    return () => {
      attachmentItems.forEach((item) => {
        if (item.url?.startsWith('blob:')) {
          URL.revokeObjectURL(item.url)
        }
      })
    }
  }, [attachmentItems])

  const handleSend = useCallback(async (content: string) => {
    if (!content.trim() && attachmentItems.length === 0) return

    try {
      const userMessage: Message = {
        key: Date.now().toString(),
        role: 'my',
        content: content || '[附件]',
        attachments: [...attachmentItems],
        timestamp: Date.now(),
      }
      setMessages((prev) => [...prev, userMessage])
      setInputValue('')
      setAttachmentItems([])
      setAttachmentsOpen(false)
      setLoading(true)

      await new Promise((resolve) => setTimeout(resolve, 1500))

      const assistantMessage: Message = {
        key: (Date.now() + 1).toString(),
        role: 'ai',
        content: `收到你的消息：${content}

## 代码示例

\`\`\`javascript
function hello() {
  console.log("Hello, World!");
}
\`\`\`

#### Sequence Diagram

\`\`\` mermaid
sequenceDiagram
    participant Client
    participant Server
    participant Database

    Client->>Server: POST /api/data
    Server->>Database: INSERT record
    Database-->>Server: Success
    Server-->>Client: 201 Created
\`\`\`

### 数学公式

行内公式：$E = mc^2$

块级公式：
$$
f(x) = \\int_{-\\infty}^{\\infty} \\hat f(\\xi)\\,e^{2 \\pi i \\xi x} \\,d\\xi
$$

### 参考资料

- [MDN Web Docs](https://developer.mozilla.org)<sup>1</sup>
- [Stack Overflow](https://stackoverflow.com)<sup>2</sup>

### 思考过程

<think>这是一个技术问题，我将提供代码示例和详细说明。</think>

### 思维链

<thoughtchain>
1. 分析用户问题，理解需求
2. 检索相关知识点和代码示例
3. 组织答案结构，提供详细说明
4. 验证答案准确性
</thoughtchain>`,
        timestamp: Date.now(),
      }
      setMessages((prev) => [...prev, assistantMessage])
      message.success('消息发送成功')
    } catch (error) {
      message.error('发送消息失败，请重试')
      console.error('Send message error:', error)
    } finally {
      setLoading(false)
    }
  }, [attachmentItems, message])

  const handleConversationSelect = useCallback((key: string, item?: any) => {
    setActiveConv(key)
    setMessages([
      {
        key: '1',
        role: 'ai',
        content: `已切换到会话：${item?.label || '新会话'}\n\n这是会话历史记录的模拟展示。`,
        timestamp: Date.now(),
      },
    ])
  }, [])

  const handleNewConversation = useCallback(() => {
    const newKey = Date.now().toString()
    setConversations((prev) => [
      {key: newKey, label: '新会话', icon: <MessageOutlined/>},
      ...prev,
    ])
    setActiveConv(newKey)
    setMessages([
      {
        key: '1',
        role: 'ai',
        content: '你好！我是 AI 助手，有什么可以帮助你的吗？',
        timestamp: Date.now(),
      },
    ])
  }, [])

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

  const items: BubbleListProps['items'] = useMemo(() =>
      messages.map((item) => ({
        key: item.key,
        role: item.role,
        content: item.content,
        attachments: item.attachments,
        loading: item.role === 'ai' && loading && item.key === messages[messages.length - 1]?.key,
      })),
    [messages, loading, token.colorSuccess, token.colorPrimary]
  )

  const memoRole: BubbleListProps['role'] = useMemo(
    () => ({
      ai: {
        typing: true,
        header: '智能助手',
        contentRender: (content: React.ReactNode) => {
          return (
            <XMarkdown
              content={content as string}
              components={{
                think: ThinkComponent,
                code: CodeComponent,
                sup: getSupComponent(sourceItems),
                thoughtchain: renderThoughtChain,
              }}
              config={{extensions: Latex()}}
            />
          )
        },
        loadingRender: () => (
          <Space>
            <Spin size='small'/>
            {'正在生成内容，敬请等待。。。'}
          </Space>
        ),
        avatar: () => <Avatar icon={<RobotOutlined/>} style={{backgroundColor: token.colorPrimary}}/>,
        footer: ((content, info) => {
          return <div style={{display: 'flex'}}><label><Typography.Text
            type='secondary'>以上内容由AI生成，请注意甄别。</Typography.Text></label>
          </div>
        }),
      },
      user: (data) => ({
        typing: false,
        header: `User-${data.key}`,
        contentRender: (content: React.ReactNode) => {
          return (
            <XMarkdown
              content={content as string}
              components={{
                think: ThinkComponent,
                code: CodeComponent,
                sup: getSupComponent(sourceItems),
                thoughtchain: renderThoughtChain,
              }}
              config={{extensions: Latex()}}
            />
          )
        },
        avatar: () => <Avatar icon={<UserOutlined/>} style={{backgroundColor: token.colorSuccess}}/>,
      }),
      my: (data) => ({
        placement: 'end',
        typing: false,
        header: `我自己`,
        contentRender: (content: React.ReactNode) => {
          return (
            <XMarkdown
              content={content as string}
              components={{
                think: ThinkComponent,
                code: CodeComponent,
                sup: getSupComponent(sourceItems),
                thoughtchain: renderThoughtChain,
              }}
              config={{extensions: Latex()}}
            />
          )
        },
        avatar: () => <Avatar icon={<UserOutlined/>} style={{backgroundColor: token.colorSuccess}}/>,
      }),
      tip: {
        variant: 'filled',
        styles: {root: {padding: 0}, content: {display: 'flex', justifyContent: 'center', alignItems: 'center'}},
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
        <div className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <Button
              type='dashed'
              onClick={handleNewConversation}
              block
            >
              新建会话
            </Button>
          </div>
          <div className={styles.sidebarContent}>
            <Conversations
              items={conversations}
              activeKey={activeConv}
              onActiveChange={handleConversationSelect}
            />
          </div>
          <Footer style={{padding: '12px 16px'}}/>
        </div>

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
              value={inputValue}
              onChange={setInputValue}
              onSubmit={handleSend}
              placeholder='请输入您的问题...'
              header={senderHeader}
              prefix={
                <Badge dot={attachmentItems.length > 0 && !attachmentsOpen}>
                  <Button onClick={() => setAttachmentsOpen(!attachmentsOpen)} icon={<LinkOutlined/>}/>
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
