import {
  forwardRef,
  ForwardRefRenderFunction,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import {Button, Input, Pagination, theme} from 'antd'
import {Conversations} from '@ant-design/x'
import {createStyles} from 'antd-style'
import {SearchOutlined, PlusOutlined} from '@ant-design/icons'
import Footer from '@/components/Footer'
import {getConversationList} from '@/services/llm/conversation'
import {CHANNEL_COMMON} from '@/chatProviders/CommonChatProvider'
import {uuidV4} from '@/utils/util'
import dayjs from 'dayjs'

export interface Conversation {
  key: string;
  label: string;
  icon?: React.ReactNode;
  group?: string;
}

interface ConversationListProps {
  conversations?: Conversation[];
  activeKey: string;
  onConversationSelect: (key: string, item?: any) => void;
  onNewConversation: () => any;
}

export type ConversationListAction = {
  modifyInitLabel: (conversationCode: string, label: string) => void;
  getConvByLabel: (label: string) => Conversation | undefined;
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

    .ant-pro-global-footer {
      margin-block-start: 24px;
      margin-block-end: 13px;
    }
  `,
  search: css`
    padding: 0 16px;
  `,
}))

const ConversationList: ForwardRefRenderFunction<ConversationListAction, ConversationListProps> = (
  {activeKey, onConversationSelect, onNewConversation},
  ref,
) => {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const {token} = theme.useToken()
  const {styles} = useStyles()
  const [searchText, setSearchText] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [total, setTotal] = useState(0)

  useImperativeHandle(ref, () => ({
    modifyInitLabel: (conversationCode: string, label: string) => {
      const conversation = conversations.find((_) => _.key === conversationCode)
      if (conversation?.label === '新会话') {
        conversation.label = label
        setConversations([...conversations])
      }
    },
    getConvByLabel: (label: string) => {
      return conversations.find((i) => i.label === label)
    },
  }))

  const loadConversationList = async (index = 1, size = 10, keywords: string = '') => {
    let ret = await getConversationList(index || currentPage, size || pageSize, {
      channel: CHANNEL_COMMON,
      keywords,
    })
    let list = ret.rows || []
    if (!list.length) {
      let newKey = uuidV4()
      setConversations([
        {
          key: newKey,
          label: '新会话',
          group: '今天',
        },
      ])
      setTotal(1)
      onConversationSelect(newKey)
      return
    } else {
      setTotal(ret.total)
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
    onConversationSelect(list[0].conversationCode)
  }

  useEffect(() => {
    loadConversationList()
  }, [])

  const handlePageChange = useCallback(
    (page: number, pageSize?: number) => {
      setCurrentPage(page)
      if (pageSize) setPageSize(pageSize)
      loadConversationList(page, pageSize, searchText)
    },
    [searchText, pageSize],
  )

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchText(e.target.value)
  }, [])
  const handleSearch = useCallback(() => {
    setCurrentPage(1)
    loadConversationList(1, pageSize, searchText)
  }, [searchText, pageSize])

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Button
          type='dashed'
          onClick={() => {
            let newConv = onNewConversation()
            if (newConv) {
              setConversations([newConv, ...conversations])
            }
          }}
          block
          icon={<PlusOutlined/>}
        >
          新建会话
        </Button>
      </div>
      <div className={styles.content}>
        <Conversations
          items={conversations}
          activeKey={activeKey}
          onActiveChange={onConversationSelect}
        />
      </div>
      <div className={styles.footer}>
        {total > pageSize && (
          <Pagination
            simple
            current={currentPage}
            total={total}
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
            onPressEnter={handleSearch}
          />
        </div>
        <Footer
          style={{borderTop: `1px solid ${token.colorBorder}`}}
        />
      </div>
    </div>
  )
}

export default forwardRef(ConversationList)
