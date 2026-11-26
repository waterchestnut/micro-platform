import React from 'react'
import {Tag, Tooltip} from 'antd'

/**
 * @fileOverview 知识库系页面的枚举元数据与轻部件（列表/详情/材料/召回共用）
 */

export const statusMeta: Record<string, {text: string; color: string}> = {
  '0': {text: '正常使用', color: 'green'},
  '1': {text: '已禁用', color: 'default'},
  '-1': {text: '已删除', color: 'red'},
}

export const StatusTag: React.FC<{status?: number}> = ({status}) => {
  const m = statusMeta[String(status)] || {text: `状态${status ?? '-'}`, color: 'default'}
  return <Tag color={m.color} bordered={false} style={{marginInlineEnd: 0}}>{m.text}</Tag>
}

export const permissionMeta: Record<string, {text: string; color: string; full: string}> = {
  member: {text: '仅成员', color: 'blue', full: '仅知识库成员可用'},
  union: {text: '联盟共享', color: 'green', full: '联盟平台内共享（公开）'},
  platform: {text: '机构共享', color: 'cyan', full: '机构平台内共享'},
  department: {text: '指定部门', color: 'purple', full: '指定部门成员可用'},
}

export const PermissionTag: React.FC<{permission?: string}> = ({permission}) => {
  const m = permissionMeta[permission || '']
  if (!m) return <Tag bordered={false} style={{marginInlineEnd: 0}}>{permission || '未知权限'}</Tag>
  return <Tooltip title={m.full}><Tag color={m.color} bordered={false} style={{marginInlineEnd: 0}}>{m.text}</Tag></Tooltip>
}

export const handleStatusMeta: Record<string, {text: string; color: string}> = {
  '-1': {text: '处理出错', color: 'red'},
  '0': {text: '待处理', color: 'orange'},
  '1': {text: '处理中', color: 'blue'},
  '2': {text: '处理完成', color: 'green'},
}

export const HandleStatusTag: React.FC<{handleStatus?: number; handleError?: string}> = ({handleStatus, handleError}) => {
  const m = handleStatusMeta[String(handleStatus)] || {text: `处理状态${handleStatus ?? '-'}`, color: 'default'}
  const tag = <Tag color={m.color} bordered={false} style={{marginInlineEnd: 0}}>{m.text}</Tag>
  if (String(handleStatus) === '-1' && handleError) {
    return <Tooltip title={handleError} styles={{root: {maxWidth: 420}}}>{tag}</Tooltip>
  }
  return tag
}

export const memberTypeMeta: Record<string, {text: string; color: string}> = {
  owner: {text: '创建者', color: 'gold'},
  admin: {text: '管理员', color: 'blue'},
  user: {text: '用户', color: 'default'},
  pending: {text: '待审批', color: 'orange'},
}

export const MemberTypeTag: React.FC<{memberType?: string}> = ({memberType}) => {
  const m = memberTypeMeta[memberType || '']
  if (!m) return <>{memberType || '-'}</>
  return <Tag color={m.color} bordered={false} style={{marginInlineEnd: 0}}>{m.text}</Tag>
}

/** 相似度分档着色：≥0.75 优 / ≥0.6 良 / ≥0.5 弱 / 其余差 */
export const simBadge = (sim?: number): {text: string; color: string} | null => {
  if (typeof sim !== 'number' || Number.isNaN(sim)) return null
  const v = sim.toFixed(3)
  if (sim >= 0.75) return {text: `相似度 ${v}`, color: 'green'}
  if (sim >= 0.6) return {text: `相似度 ${v}`, color: 'blue'}
  if (sim >= 0.5) return {text: `相似度 ${v}`, color: 'orange'}
  return {text: `相似度 ${v}`, color: 'red'}
}

/** 轻量时间格式化，避免为展示引入 dayjs 依赖 */
export const formatTime = (ts?: string | number | Date): string => {
  if (!ts) return '-'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '-'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 代码风格小标签（模型名、标识等） */
export const CodeTag: React.FC<{text?: string; title?: string}> = ({text, title}) => {
  if (!text) return null
  return <Tooltip title={title || text}>
    <Tag bordered={false} style={{
      marginInlineEnd: 0, fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
      fontSize: 12, color: 'rgba(0,0,0,0.55)', background: 'rgba(0,0,0,0.03)', maxWidth: 180,
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'middle',
    }}>{text}</Tag>
  </Tooltip>
}
