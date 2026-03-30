import { useState, useRef } from 'react';
import { Flex, Avatar, Button, theme, Tooltip } from 'antd';
import { Bubble, Sender, Conversations, Think, Sources, Mermaid, XProvider, BubbleListProps, Attachments } from '@ant-design/x';
import { PaperClipOutlined, AudioOutlined } from '@ant-design/icons';
import { XMarkdown } from '@ant-design/x-markdown';
import { PageContainer } from '@ant-design/pro-components';
import Footer from '@/components/Footer';
import { UserOutlined, RobotOutlined, MessageOutlined } from '@ant-design/icons';

interface Conversation {
  key: string;
  label: string;
  icon?: React.ReactNode;
}

interface Message {
  key: string;
  role: 'user' | 'ai';
  content: string;
  attachments?: { key: string; uid: string; name: string; url: string; status: 'done' }[];
}

const Chat: React.FC = () => {
  const { token } = theme.useToken();
  const [conversations, setConversations] = useState<Conversation[]>([
    { key: '1', label: '如何实现快速排序算法？', icon: <MessageOutlined /> },
    { key: '2', label: '解释一下什么是微服务架构', icon: <MessageOutlined /> },
    { key: '3', label: '帮我写一个Python脚本', icon: <MessageOutlined /> },
  ]);
  const [activeConv, setActiveConv] = useState<string>('1');
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
    },
  ]);
  const [loading, setLoading] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [attachments, setAttachments] = useState<any[]>([]);
  const listRef = useRef<any>(null);

  const handleSend = (content: string) => {
    if (!content.trim() && attachments.length === 0) return;

    const userMessage: Message = {
      key: Date.now().toString(),
      role: 'user',
      content: content || '[附件]',
      attachments: attachments.map((file, index) => ({
        key: `file-${index}`,
        uid: file.uid || String(index),
        name: file.name,
        url: file.url || URL.createObjectURL(file.originFileObj || file),
        status: 'done',
      })),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setAttachments([]);
    setLoading(true);

    setTimeout(() => {
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
      };
      setMessages((prev) => [...prev, assistantMessage]);
      setLoading(false);
    }, 1500);
  };

  const handleConversationSelect = (key: string, item?: any) => {
    setActiveConv(key);
    setMessages([
      {
        key: '1',
        role: 'ai',
        content: `已切换到会话：${item?.label || '新会话'}\n\n这是会话历史记录的模拟展示。`,
      },
    ]);
  };

  const handleNewConversation = () => {
    const newKey = Date.now().toString();
    setConversations((prev) => [
      { key: newKey, label: '新会话', icon: <MessageOutlined /> },
      ...prev,
    ]);
    setActiveConv(newKey);
    setMessages([
      {
        key: '1',
        role: 'ai',
        content: '你好！我是AI助手，有什么可以帮助你的吗？',
      },
    ]);
  };

  const items: BubbleListProps['items'] = messages.map((item) => ({
    key: item.key,
    role: item.role,
    content: item.content,
    contentRender: (content) => (
      <XMarkdown
        content={content as string}
        components={{
          think: Think as any,
          sources: Sources as any,
          mermaid: Mermaid as any,
        }}
      />
    ),
    attachments: item.attachments as any,
    loading: item.role === 'ai' && loading && item.key === messages[messages.length - 1]?.key,
    avatar: item.role === 'user'
      ? <Avatar icon={<UserOutlined />} style={{ backgroundColor: token.colorSuccess }} />
      : <Avatar icon={<RobotOutlined />} style={{ backgroundColor: token.colorPrimary }} />,
  }));

  return (
    <XProvider>
      <Flex style={{ height: '100%', backgroundColor: token.colorBgLayout }}>
        <div style={{
          width: 280,
          borderRight: `1px solid ${token.colorBorder}`,
          backgroundColor: token.colorBgContainer,
          display: 'flex',
          flexDirection: 'column',
        }}>
          <div style={{ padding: '16px', borderBottom: `1px solid ${token.colorBorder}` }}>
            <Button
              type="dashed"
              onClick={handleNewConversation}
              block
            >
              新建会话
            </Button>
          </div>
          <div style={{ flex: 1, overflow: 'auto' }}>
            <Conversations
              items={conversations}
              activeKey={activeConv}
              onActiveChange={handleConversationSelect}
            />
          </div>
          <Footer style={{ padding: '12px 16px' }} />
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
            <Bubble.List
              ref={listRef}
              items={items}
              autoScroll
              style={{ maxWidth: 900, margin: '0 auto' }}
            />
          </div>
          <div style={{ padding: '16px 24px', backgroundColor: token.colorBgContainer, borderTop: `1px solid ${token.colorBorder}` }}>
            <Sender
              value={inputValue}
              onChange={setInputValue}
              onSubmit={handleSend}
              placeholder="请输入您的问题..."
              allowSpeech
              onPasteFile={(files) => {
                const fileList = Array.from(files).map((file, index) => ({
                  uid: `paste-${index}`,
                  name: file.name,
                  originFileObj: file,
                }));
                setAttachments((prev) => [...prev, ...fileList]);
              }}
              suffix={
                <Flex gap="small">
                  <Tooltip title="附件">
                    <Button
                      type="text"
                      icon={<PaperClipOutlined />}
                      onClick={() => {
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.multiple = true;
                        input.onchange = () => {
                          if (input.files) {
                            const fileList = Array.from(input.files).map((file, index) => ({
                              uid: `file-${Date.now()}-${index}`,
                              name: file.name,
                              originFileObj: file,
                            }));
                            setAttachments((prev) => [...prev, ...fileList]);
                          }
                        };
                        input.click();
                      }}
                    />
                  </Tooltip>
                  <Tooltip title="语音输入">
                    <Button
                      type="text"
                      icon={<AudioOutlined />}
                    />
                  </Tooltip>
                </Flex>
              }
              style={{ maxWidth: 900, margin: '0 auto' }}
            />
            {attachments.length > 0 && (
              <Attachments
                items={attachments.map((file, index) => ({
                  key: file.uid || String(index),
                  uid: file.uid || String(index),
                  name: file.name,
                  status: 'done',
                }))}
                onRemove={(file) => {
                  setAttachments((prev) => prev.filter((item) => item.uid !== file.uid));
                }}
                style={{ marginTop: 8, maxWidth: 900 }}
              />
            )}
          </div>
        </div>
      </Flex>
    </XProvider>
  );
};

export default Chat;
