import {useState, useRef, useMemo, useEffect, useCallback} from 'react'
import {Flex, Avatar, Button, theme, message, Badge, type GetProp, type GetRef} from 'antd'
import {
  Bubble,
  Sender,
  Conversations,
  Think,
  Sources,
  Mermaid,
  XProvider,
  BubbleListProps,
  Attachments,
  type AttachmentsProps
} from '@ant-design/x'
import {CloudUploadOutlined} from '@ant-design/icons'
import {XMarkdown} from '@ant-design/x-markdown'
import {PageContainer} from '@ant-design/pro-components'
import Footer from '@/components/Footer'
import {UserOutlined, RobotOutlined, MessageOutlined, LinkOutlined} from '@ant-design/icons'

interface Conversation {
  key: string;
  label: string;
  icon?: React.ReactNode;
}

interface Message {
  key: string;
  role: 'my' | 'ai' | 'system' | 'user';
  content: string;
  attachments?: AttachmentItem[];
  timestamp?: number;
}

type AttachmentItem = GetProp<AttachmentsProps, 'items'>[number];

const Chat: React.FC = () => {
  const {token} = theme.useToken()
  const [conversations, setConversations] = useState<Conversation[]>([
    {key: '1', label: '如何实现快速排序算法？', icon: <MessageOutlined/>},
    {key: '2', label: '解释一下什么是微服务架构', icon: <MessageOutlined/>},
    {key: '3', label: '帮我写一个 Python 脚本', icon: <MessageOutlined/>},
  ])
  const [activeConv, setActiveConv] = useState<string>('1')
  const [messages, setMessages] = useState<Message[]>([
    {
      key: '1',
      role: 'ai',
      content: `# 欢迎使用 AI 助手

我可以帮助你：
- 解答技术问题
- 编写代码
- 解释概念
- 分析数据

请在下方输入你的问题！`,
      timestamp: Date.now(),
    },
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

### 数学公式

行内公式：$E = mc^2$

块级公式：
$$
f(x) = \\int_{-\\infty}^{\\infty} \\hat f(\\xi)\\,e^{2 \\pi i \\xi x} \\,d\\xi
$$

### 参考资料

- [MDN Web Docs](https://developer.mozilla.org)
- [Stack Overflow](https://stackoverflow.com)

### 思考过程

这是一个技术问题，我将提供代码示例和详细说明。`,
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

  const items: BubbleListProps['items'] = useMemo(() =>
      messages.map((item) => ({
        key: item.key,
        role: item.role,
        content: item.content,
        contentRender: (content: React.ReactNode) => (
          <XMarkdown
            content={content as string}
            components={{
              think: Think as any,
              sources: Sources as any,
              mermaid: Mermaid as any,
            }}
          />
        ),
        attachments: item.attachments,
        loading: item.role === 'ai' && loading && item.key === messages[messages.length - 1]?.key,
        placement: item.role === 'my' ? 'end' : 'start',
        avatar: item.role === 'my'
          ? <Avatar icon={<UserOutlined/>} style={{backgroundColor: token.colorSuccess}}/>
          : <Avatar icon={<RobotOutlined/>} style={{backgroundColor: token.colorPrimary}}/>,
      })),
    [messages, loading, token.colorSuccess, token.colorPrimary]
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
    <XProvider>
      <Flex style={{height: '100%', backgroundColor: token.colorBgLayout}}>
        <div style={{
          width: 280,
          borderRight: `1px solid ${token.colorBorder}`,
          backgroundColor: token.colorBgContainer,
          display: 'flex',
          flexDirection: 'column',
        }}>
          <div style={{padding: '16px', borderBottom: `1px solid ${token.colorBorder}`}}>
            <Button
              type='dashed'
              onClick={handleNewConversation}
              block
            >
              新建会话
            </Button>
          </div>
          <div style={{flex: 1, overflow: 'auto'}}>
            <Conversations
              items={conversations}
              activeKey={activeConv}
              onActiveChange={handleConversationSelect}
            />
          </div>
          <Footer style={{padding: '12px 16px'}}/>
        </div>

        <div style={{flex: 1, display: 'flex', flexDirection: 'column'}}>
          <div style={{flex: 1, overflow: 'auto', padding: '24px'}}>
            <Bubble.List
              ref={listRef}
              items={items}
              autoScroll
              style={{maxWidth: 1200, margin: '0 auto'}}
            />
          </div>
          <div style={{
            padding: '16px 24px',
            backgroundColor: token.colorBgContainer,
            borderTop: `1px solid ${token.colorBorder}`
          }}>
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
              style={{maxWidth: 1200, margin: '0 auto'}}
            />
          </div>
        </div>
      </Flex>
    </XProvider>
  )
}

export default Chat
