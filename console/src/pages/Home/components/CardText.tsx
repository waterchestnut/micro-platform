import {history} from '@umijs/max'
import React from 'react'
import {theme} from 'antd'

const {useToken} = theme

interface CardTextProps {
  content?: string
  color?: string
  url?: string
}

/** 首页卡片标题文本：可带跳转，超长省略 */
const CardText: React.FC<CardTextProps> = ({content, color, url}) => {
  const {token} = useToken()

  if (!content) return null

  const handleClick = () => {
    if (!url) return
    if (url.startsWith('http')) {
      window.open(url, '_blank')
    } else {
      history.push(url)
    }
  }

  return (
    <div
      style={{
        color: color || token.colorText,
        fontSize: 14,
        fontWeight: 500,
        cursor: url ? 'pointer' : undefined,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
      title={content}
      onClick={handleClick}
    >
      {content}
    </div>
  )
}

export default CardText
