import {history} from '@umijs/max'
import React from 'react'
import {theme} from 'antd'

const {useToken} = theme

interface CardHighlightProps {
  prefix?: string
  count?: number
  suffix?: string
  count2?: number
  suffix2?: string
  url?: string
}

/** 首页卡片高亮统计条：前缀 + 强调数字 + 后缀，数字用主色大号呈现 */
const CardHighlight: React.FC<CardHighlightProps> = ({
  prefix,
  count,
  suffix,
  count2,
  suffix2,
  url,
}) => {
  const {token} = useToken()

  const handleClick = () => {
    if (!url) return
    if (url.startsWith('http')) {
      window.open(url, '_blank')
    } else {
      history.push(url)
    }
  }

  const numStyle: React.CSSProperties = {
    color: token.colorPrimary,
    fontSize: 20,
    fontWeight: 600,
    margin: '0 2px',
    lineHeight: 1,
    fontFamily: token.fontFamily,
  }
  const labelStyle: React.CSSProperties = {color: token.colorTextSecondary, fontSize: 13}

  return (
    <div
      style={{
        marginTop: 8,
        display: 'flex',
        alignItems: 'baseline',
        flexWrap: 'wrap',
        rowGap: 4,
        cursor: url ? 'pointer' : undefined,
      }}
      onClick={handleClick}
    >
      <span style={labelStyle}>{prefix}</span>
      {count !== undefined && <span style={numStyle}>{count}</span>}
      <span style={labelStyle}>{suffix}</span>
      {count2 !== undefined && (
        <>
          <span style={{width: 8}}/>
          <span style={numStyle}>{count2}</span>
          <span style={labelStyle}>{suffix2}</span>
        </>
      )}
    </div>
  )
}

export default CardHighlight
