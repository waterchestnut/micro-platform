import {history, useModel} from '@umijs/max'
import {Avatar, Button, ConfigProvider, Flex, Input, Segmented, Spin, theme} from 'antd'
import {
  FileTextOutlined,
  BookOutlined,
  TeamOutlined,
  GiftOutlined,
  ReadOutlined,
  VideoCameraOutlined,
  SolutionOutlined,
  ExperimentOutlined,
  FormOutlined,
  PlusOutlined,
  CloseOutlined,
  SendOutlined,
} from '@ant-design/icons'
import React, {useState, useEffect} from 'react'
import {registerCatalog, XCard} from '@ant-design/x-card'
import type {Catalog, XAgentCommand_v0_9} from '@ant-design/x-card'
import {CARD_LIST, fetchCardA2UICommands} from './mockData'
import {CardText, CardHighlight, CardList, CardSchedule, CardContent} from './components'
import catalog from './catalog.json'
import {getPCWidgets} from '@/services/app/widget'
import {request} from '@umijs/max'
import {getDocHttpUrl} from '@/utils/util'
import {useFulltextSchedule} from '@/components/Fulltext'

// @ts-ignore
const gatewayBaseUrl = API_GATEWAY_BASE
import {uuidV4} from '@/utils/util'
import {errorMessage} from '@/utils/msg'
import {Footer} from '@/components'

const {useToken} = theme

registerCatalog(catalog as unknown as Catalog)

const chatTypes = [
  {value: 'chat', label: '对话'},
  {value: 'research', label: '学术调研'},
  {value: 'resource', label: '资源检索'},
  {value: 'subscribe', label: '文献订阅'},
]

const placeholderMap = {
  'chat': `您可以向我提问，例如：我今天有什么工作需要完成
您也可以选择其他类型的对话模式，让我给您提供更精准的服务`,
  'research': `您可以向我提出要求，我来帮您汇总资源，并总结调研报告
例如：我想了解未来智慧图书馆的研究进展`,
  'resource': `传统资源检索模式，请输入检索关键词，多关键词可用空格隔开
例如：未来智慧图书馆 人工智能`,
  'subscribe': `您可以设定一个主题，我在一定周期内持续向您推送资源，您可以随时调整需求
例如：有关图书馆在馆舍设计、技术应用方面的研究`
}

interface CardState extends APPAPI.Widget {
  id: string
  title: string
  icon?: React.ReactNode
  commands: XAgentCommand_v0_9[]
  loading: boolean
  error?: string
}

const cardIcons: Record<string, React.ReactNode> = {
  card_research: <ExperimentOutlined/>,
  card_subscribe: <FileTextOutlined/>,
  card_group_read: <TeamOutlined/>,
  card_scholar: <TeamOutlined/>,
  card_crowd: <GiftOutlined/>,
  card_foleac: <ReadOutlined/>,
  card_call_course: <VideoCameraOutlined/>,
  card_crowd_learn: <GiftOutlined/>,
  card_mopit: <SolutionOutlined/>,
  card_graduate: <BookOutlined/>,
  card_affair: <FormOutlined/>,
}

const Index: React.FC = () => {
  const {token} = useToken()
  const {initialState} = useModel('@@initialState')
  const {scheduleFulltext} = useFulltextSchedule()
  const [cards, setCards] = useState<CardState[]>([])
  const [inputValue, setInputValue] = useState('')
  const [selectedType, setSelectedType] = useState<string>('chat')
  const [typePlaceholder, setTypePlaceholder] = React.useState<string>(placeholderMap.chat);

  const loadMockCards = async () => {
    const cardStates: CardState[] = CARD_LIST.map((card) => ({
      id: card.id,
      title: card.title,
      icon: cardIcons[card.id],
      commands: [],
      loading: true,
      widgetCode: card.id,
      clientCode: 'test',
    }))
    setCards(cardStates)

    const loadedCards = await Promise.all(
      CARD_LIST.map(async (card) => {
        const commands = await fetchCardA2UICommands(card.id)
        return {
          id: card.id,
          title: card.title,
          icon: cardIcons[card.id],
          commands,
          loading: false,
          widgetCode: card.id,
          clientCode: 'test',
        }
      })
    )
    setCards(loadedCards)
  }

  const loadRemoteCards = async () => {
    console.log('Loading remote cards...')
    const cardStates: CardState[] = (await getPCWidgets()).map((card) => ({
      id: card.widgetCode,
      title: card.widgetName || '',
      icon: null,
      commands: [],
      loading: true,
      ...card
    }))
    setCards(cardStates)

    /*单卡接口失败不拖垮整区：allSettled 逐项隔离，失败卡显示占位与整体重试*/
    const results = await Promise.allSettled(
      cardStates.map(async (card) => {
        let url = card.apiUrl?.startsWith('http') ? card.apiUrl : `${gatewayBaseUrl}${card.apiUrl}` as string
        return ((await request(url, {
          method: 'GET',
          params: {surfaceId: card.id, homeEndpoint: 'pc'}
        }))?.data || []) as XAgentCommand_v0_9[]
      })
    )
    const loadedCards = cardStates.map((card, i) => {
      const r = results[i]
      if (r.status === 'fulfilled') {
        return {...card, commands: r.value, loading: false}
      }
      console.warn('home widget load failed:', card.id, r.reason)
      return {...card, commands: [], loading: false, error: '内容获取失败'}
    })
    setCards(loadedCards)
  }

  useEffect(() => {

    //loadMockCards()
    loadRemoteCards()
  }, [])

  const handleRemoveCard = (id: string) => {
    setCards(cards.filter((card) => card.id !== id))
  }

  const handleAddCard = () => {
    console.log('添加新卡片')
  }

  const handleSend = () => {
    if (selectedType === 'chat') {
      const params = inputValue.trim()
        ? `?initialQuery=${encodeURIComponent(inputValue.trim())}`
        : ''
      history.push('/chat' + params)
    }
    if (selectedType === 'resource') {
      const params = inputValue.trim() ? `/res/search/${inputValue.trim()}` : ''
      window.location.href = `/sub/callin-search?callin-search=${encodeURIComponent(params)}`
    }
    if (selectedType === 'research') {
      if (!inputValue.trim()) {
        return errorMessage('请先提出要求')
      }
      const params = `/research/new/?researchCode=${uuidV4()}&topic=${inputValue.trim()}`
      window.location.href = `/sub/callin-survey?callin-survey=${encodeURIComponent(params)}`
    }
    if (selectedType === 'subscribe') {
      if (!inputValue.trim()) {
        return errorMessage('请先提出要求')
      }
      const params = `/claim/ongoing/?title=${inputValue.trim()}`
      window.location.href = `/sub/callin-subs?callin-subs=${encodeURIComponent(params)}`
    }
  }

  return (
    <ConfigProvider
      theme={{
        components: {
          Segmented: {
            itemSelectedBg: token.colorPrimary,
            itemSelectedColor: '#fff',
            itemHoverBg: token.colorPrimaryHover,
            itemHoverColor: '#fff',
            itemActiveBg: token.colorPrimaryActive,
            trackPadding: 2,
          },
        },
      }}
    >
      <div
        style={{
          padding: '32px 40px',
          minHeight: 'calc(100vh - 64px)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* 搜索区域 */}
        <div style={{margin: '40px auto', width: '100%', maxWidth: 800}}>
          <div
            style={{
              border: `1px solid ${token.colorBorder}`,
              borderRadius: 16,
              padding: '16px 20px',
              background: token.colorBgContainer,
              boxShadow: token.boxShadow,
            }}
          >
            <Input.TextArea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={typePlaceholder}
              autoSize={{minRows: 2, maxRows: 4}}
              variant='borderless'
              style={{fontSize: 14}}
            />
            <Flex justify='space-between' align='center' style={{marginTop: 8}}>
              <Segmented
                value={selectedType}
                onChange={(value) => {
                  setSelectedType(value as string)
                  // @ts-ignore
                  setTypePlaceholder(placeholderMap[value] || '');
                }}
                options={chatTypes}
                size='middle'
              />
              <Button
                type='primary'
                shape='circle'
                icon={<SendOutlined/>}
                onClick={handleSend}
              />
            </Flex>
          </div>
        </div>

        {/* 卡片网格区域 - 使用 XCard 渲染 A2UI 协议数据 */}
        {/*<div style={{ marginBottom: 16, textAlign: 'center' }}>
          <Button
            type='dashed'
            onClick={() => scheduleFulltext('117620368', { title: '测试资源标题' })}
          >
            测试全文调度
          </Button>
        </div>*/}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(480px, 1fr))',
            gap: 16,
            flex: 1,
            alignContent: 'flex-start',
          }}
        >
          {cards.map((card) => (
            <XCard.Box
              key={card.id}
              commands={card.commands}
              components={{
                CardText,
                CardHighlight,
                CardList,
                CardSchedule,
                CardContent,
              }}
            >
              <div
                style={{
                  border: `1px solid ${token.colorBorderSecondary}`,
                  borderRadius: token.borderRadius,
                  background: token.colorBgContainer,
                  overflow: 'hidden',
                }}
              >
                {/* Card Header */}
                <div
                  style={{
                    borderBottom: `1px solid ${token.colorBorderSecondary}`,
                    padding: '12px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <Flex align='center' gap={8}>
                    {
                      card.icon ?
                        <span style={{color: token.colorPrimary}}>{card.icon}</span>
                        : card.logoUrl ?
                          <Avatar src={getDocHttpUrl(card.logoUrl)} size={16} shape='circle'/> : null
                    }
                    <span style={{fontWeight: 500}}>{card.title}</span>
                  </Flex>
                  {/*<Button
                  type='text'
                  size='small'
                  icon={<CloseOutlined style={{fontSize: 12}}/>}
                  onClick={() => handleRemoveCard(card.id)}
                  style={{color: token.colorTextTertiary}}
                />*/}
                </div>

                {/* Card Content */}
                <div style={{padding: '12px 16px 16px'}}>
                  {card.loading ? (
                    <Spin size='small'/>
                  ) : card.error ? (
                    <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
                      <span style={{color: token.colorTextTertiary, fontSize: 13}}>{card.error}</span>
                      <Button size='small' type='text' onClick={loadRemoteCards}>
                        重试
                      </Button>
                    </div>
                  ) : (
                    <XCard.Card id={card.id}/>
                  )}
                </div>
              </div>
            </XCard.Box>
          ))}

          {/* 添加卡片按钮 */}
          {/*<div
          style={{
            border: `1px dashed ${token.colorBorder}`,
            borderRadius: token.borderRadius,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 120,
            cursor: 'pointer',
            transition: 'all 0.3s',
            background: token.colorBgContainer,
          }}
          onClick={handleAddCard}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = token.colorPrimary
            e.currentTarget.style.color = token.colorPrimary
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = token.colorBorder
            e.currentTarget.style.color = token.colorText
          }}
        >
          <PlusOutlined style={{fontSize: 24, color: token.colorTextTertiary}}/>
        </div>*/}
        </div>
        <Footer/>
      </div>
    </ConfigProvider>
  )
}

export default Index
