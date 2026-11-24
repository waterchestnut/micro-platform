import {history} from '@umijs/max'
import React from 'react'
import {theme} from 'antd'
import {ClockCircleOutlined, EnvironmentOutlined} from '@ant-design/icons'

const {useToken} = theme

interface CardScheduleItem {
  time?: string
  course?: string
  location?: string
  type?: 'class' | 'share'
  url?: string
}

interface CardScheduleProps {
  items?: CardScheduleItem[]
}

/** 首页卡片日程块（上课/分享安排）：主色左侧条 + 时间/课程/地点三行层次 */
const CardSchedule: React.FC<CardScheduleProps> = ({items}) => {
  const {token} = useToken()

  if (!items) return null

  const handleClick = (url?: string) => {
    if (!url) return
    if (url.startsWith('http')) {
      window.open(url, '_blank')
    } else {
      history.push(url)
    }
  }

  return (
    <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
      {items.map((item, i) => (
        <div
          key={i}
          onClick={() => handleClick(item.url)}
          style={{
            borderLeft: `3px solid ${item.type === 'class' ? token.colorPrimary : token.colorSuccess}`,
            background: token.colorFillQuaternary,
            borderRadius: token.borderRadiusSM,
            padding: '8px 12px',
            cursor: item.url ? 'pointer' : 'default',
          }}
        >
          <div style={{display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: token.colorText}}>
            <ClockCircleOutlined style={{color: token.colorPrimary}}/>
            {item.time}
            <span
              style={{
                marginLeft: 'auto',
                fontSize: 12,
                color: item.type === 'class' ? token.colorPrimary : token.colorSuccess,
              }}
            >
              {item.type === 'class' ? '上课' : '分享'}
            </span>
          </div>
          <div style={{fontSize: 13, color: token.colorTextSecondary, marginTop: 4}}>{item.course}</div>
          {item.location && (
            <div style={{fontSize: 12, color: token.colorTextTertiary, marginTop: 2, display: 'flex', alignItems: 'center', gap: 4}}>
              <EnvironmentOutlined/>
              {item.location}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export default CardSchedule
