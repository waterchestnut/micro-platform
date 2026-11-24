import React from 'react'
import {theme} from 'antd'

const {useToken} = theme

interface CardContentProps {
  children?: React.ReactNode
}

/** 首页卡片内容容器：纵向节奏排布子组件 */
const CardContent: React.FC<CardContentProps> = ({children}) => {
  const {token} = useToken()

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        color: token.colorText,
        fontSize: 14,
        lineHeight: '22px',
      }}
    >
      {children}
    </div>
  )
}

export default CardContent
