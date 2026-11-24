import {history} from '@umijs/max'
import React from 'react'
import {theme} from 'antd'

const {useToken} = theme

interface CardListItem {
  status?: 'success' | 'error' | 'default'
  text?: string
  url?: string
}

interface CardListProps {
  items?: (string | CardListItem)[]
}

/**
 * 首页卡片动态列表。
 * status 为供给端语义：success=正向动态、error=需关注（风险/待办）、default=中性；
 * 仅以色点区分，不再叠加文案前缀（旧版【成功】/【失败】/【取消】与服务端语义错位，已废弃）。
 */
const CardList: React.FC<CardListProps> = ({items}) => {
  const {token} = useToken()

  if (!items) return null

  const dotColor: Record<string, string> = {
    success: token.colorSuccess,
    error: token.colorWarning,
    default: token.colorTextQuaternary,
  }

  const handleClick = (url?: string) => {
    if (!url) return
    if (url.startsWith('http')) {
      window.open(url, '_blank')
    } else {
      history.push(url)
    }
  }

  return (
    <div style={{fontSize: 13, lineHeight: '20px'}}>
      {items.map((item, i) => {
        if (typeof item === 'string') {
          return <div key={i} style={{marginBottom: 6}}>{item}</div>
        }
        const clickable = !!item.url
        return (
          <div
            key={i}
            onClick={() => handleClick(item.url)}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              marginBottom: 6,
              cursor: clickable ? 'pointer' : 'default',
              borderRadius: token.borderRadiusSM,
              padding: '2px 4px',
              marginLeft: -4,
              transition: 'background 0.2s',
            }}
            onMouseEnter={e => {
              if (clickable) (e.currentTarget as HTMLDivElement).style.background = token.colorFillQuaternary
            }}
            onMouseLeave={e => {
              ;(e.currentTarget as HTMLDivElement).style.background = 'transparent'
            }}
          >
            <span
              style={{
                flex: 'none',
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: dotColor[item.status || 'default'] || dotColor.default,
                marginTop: 7,
              }}
            />
            <span style={{color: token.colorText, wordBreak: 'break-all'}}>{item.text}</span>
          </div>
        )
      })}
    </div>
  )
}

export default CardList
