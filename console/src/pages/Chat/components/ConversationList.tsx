import {useState, useMemo, useCallback} from 'react'
import {Button, Input, Pagination, theme} from 'antd'
import {Conversations} from '@ant-design/x'
import {createStyles} from 'antd-style'
import {SearchOutlined, PlusOutlined} from '@ant-design/icons'
import Footer from '@/components/Footer'

export interface Conversation {
  key: string;
  label: string;
  icon?: React.ReactNode;
}

interface ConversationListProps {
  conversations: Conversation[];
  activeKey: string;
  onConversationSelect: (key: string, item?: any) => void;
  onNewConversation: () => void;
}

const useStyles = createStyles(({token, css}) => ({
  container: css`
    width: 280px;
    border-right: 1px solid ${token.colorBorder};
    background-color: ${token.colorBgContainer};
    display: flex;
    flex-direction: column;
    height: 100%;
  `,
  header: css`
    padding: 16px;
    border-bottom: 1px solid ${token.colorBorder};
  `,
  content: css`
    flex: 1;
    overflow: auto;
  `,
  footer: css`
    padding: 12px 0;
    display: flex;
    flex-direction: column;
    gap: 8px;

    .ant-sidebar-footer {
      margin-block-start: 24px;
      margin-block-end: 13px;
    }
  `,
  search: css`
    padding: 0 16px;
  `,
}))

const ConversationList: React.FC<ConversationListProps> = ({
                                                             conversations,
                                                             activeKey,
                                                             onConversationSelect,
                                                             onNewConversation,
                                                           }) => {
  const {token} = theme.useToken()
  const {styles} = useStyles()
  const [searchText, setSearchText] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  const filteredConversations = useMemo(() => {
    if (!searchText.trim()) return conversations
    return conversations.filter((conv) =>
      conv.label.toLowerCase().includes(searchText.toLowerCase())
    )
  }, [conversations, searchText])

  const paginatedConversations = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    const end = start + pageSize
    return filteredConversations.slice(start, end)
  }, [filteredConversations, currentPage, pageSize])

  const handlePageChange = useCallback((page: number, pageSize?: number) => {
    setCurrentPage(page)
    if (pageSize) setPageSize(pageSize)
  }, [])

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchText(e.target.value)
    setCurrentPage(1)
  }, [])

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Button
          type='dashed'
          onClick={onNewConversation}
          block
          icon={<PlusOutlined/>}
        >
          新建会话
        </Button>
      </div>
      <div className={styles.content}>
        <Conversations
          items={paginatedConversations}
          activeKey={activeKey}
          onActiveChange={onConversationSelect}
        />
      </div>
      <div className={styles.footer}>
        {filteredConversations.length > pageSize && (
          <Pagination
            simple
            current={currentPage}
            total={filteredConversations.length}
            pageSize={pageSize}
            onChange={handlePageChange}
            size='small'
            style={{justifyContent: 'center', marginTop: 8}}
          />
        )}
        <div className={styles.search}>
          <Input
            placeholder='搜索会话'
            prefix={<SearchOutlined/>}
            value={searchText}
            onChange={handleSearchChange}
            allowClear
            size='small'
          />
        </div>
        <Footer style={{borderTop: `1px solid ${token.colorBorder}`}} prefixCls='sidebar-footer'/>
      </div>
    </div>
  )
}

export default ConversationList
