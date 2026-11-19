/**
 * @fileOverview 产物工作区（Agent UI 演进刀 B 的前端面，调研第八章 Artifact Workspace）
 * @module pages/Chat/components/ArtifactWorkspace
 * @description
 * 分工（架构图同款）：**聊天区说"有什么"（ArtifactCard），工作区承载"是什么"**——
 * 列表按血缘分组（版本链顺读），预览分页读回正文（增量拉取，不整吞大文件）。
 *
 * 依赖注入纪律（MessageParts/TaskCard 同款且更严）：renderText 与两个 IO 函数**必传**——
 * services/llm/artifact 经 `@umijs/max` 链进不了 jest，本组件不许对它有一行运行时 import
 * （type-only 除外，编译即擦除）。判据在 artifactView/messageParts，IO 形状在 service，
 * 组件必须能在 jest（零三方链）里被真跑。
 *
 * 诚实性：列表拉不到 ≠ "暂无产物"（两种真话分开说）；非 ready 行照列并标状态——
 * 状态闸在服务端读回执行体，这里不预判能不能读、只把拒法原文展示。
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Alert, Button, Drawer, Empty, Flex, Spin, Tag, Typography} from 'antd';
// 只 import type：services/llm/artifact 经 @umijs/max 链进不了 jest——IO 函数**必须**由调用方注入
import type {ArtifactRow, ArtifactListResult, ArtifactPage} from '@/services/llm/artifact';
import {artifactDisplayName, formatArtifactSize, groupArtifactsByLineage} from '@/chatProviders/artifactView';

const {Text} = Typography;

export type ArtifactWorkspaceProps = {
  open: boolean;
  onClose: () => void;
  conversationCode?: string;
  /** 从消息内产物卡"打开"进来时定位的产物；null=只看列表 */
  focusCode?: string | null;
  /** 正文渲染注入（生产=XMarkdown；测试=div） */
  renderText: (text: string) => React.ReactNode;
  loadList: (conversationCode: string) => Promise<ArtifactListResult>;
  loadPage: (artifactCode: string, offset?: number) => Promise<ArtifactPage>;
};

const timeStr = (v?: string | null) => {
  if (!v) return ''
  const d = new Date(String(v))
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const ArtifactWorkspace: React.FC<ArtifactWorkspaceProps> = ({
  open, onClose, conversationCode, focusCode, renderText, loadList, loadPage,
}) => {
  const [rows, setRows] = useState<ArtifactRow[]>([])
  const [listErr, setListErr] = useState('')
  const [loadingList, setLoadingList] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const [totalChars, setTotalChars] = useState<number | undefined>()
  const [readErr, setReadErr] = useState('')
  const [loadingRead, setLoadingRead] = useState(false)

  useEffect(() => {
    if (!open) return
    let dead = false
    setLoadingList(true)
    setListErr('')
    /** 重开即清预览：工作区留着上一次打开的正文，比空白更像"这就是本会话的产物"——串档事故形态 */
    setText('')
    setHasMore(false)
    setTotalChars(undefined)
    setReadErr('')
    loadList(conversationCode || '').then((r) => {
      if (dead) return
      setRows(r.ok ? r.items : [])
      if (!r.ok) setListErr(r.error || '产物清单读取失败')
      setLoadingList(false)
      if (focusCode) setSelected(focusCode)
      else if (r.items.length) setSelected(r.items[0].artifactCode)
      else setSelected(null)
    })
    return () => { dead = true }
  }, [open, conversationCode, focusCode])

  /** 换选即换文：预览不许残留上一个产物的正文（串档比空白更糟） */
  const openArtifact = useCallback((code: string) => {
    setSelected(code)
    setText(''); setHasMore(false); setTotalChars(undefined); setReadErr('')
  }, [])

  useEffect(() => {
    if (!open || !selected) return
    let dead = false
    setLoadingRead(true)
    loadPage(selected, 0).then((p) => {
      if (dead) return
      if (p.ok) {
        setText(p.text || '')
        setHasMore(p.hasMore === true)
        setTotalChars(p.totalChars)
      } else setReadErr(p.error || '产物内容读取失败')
      setLoadingRead(false)
    })
    return () => { dead = true }
  }, [open, selected, loadPage])

  const loadMore = useCallback(async () => {
    if (!selected) return
    setLoadingRead(true)
    const p = await loadPage(selected, text.length)
    if (p.ok) {
      setText((t) => t + (p.text || ''))
      setHasMore(p.hasMore === true)
      if (typeof p.totalChars === 'number') setTotalChars(p.totalChars)
    } else setReadErr(p.error || '续读失败')
    setLoadingRead(false)
  }, [selected, text.length, loadPage])

  const groups = useMemo(() => groupArtifactsByLineage(rows), [rows])
  const selRow = rows.find((r) => r.artifactCode === selected) || null

  return (
    <Drawer title="产物工作区" width={860} open={open} onClose={onClose} destroyOnClose>
      {loadingList ? <Spin/> : listErr ? (
        <Alert type="error" showIcon message={listErr}/>
      ) : !groups.length ? (
        <Empty description="本会话暂无产物"/>
      ) : (
        <Flex gap={12} align="stretch" style={{minHeight: '70%'}}>
          <div style={{width: 280, flexShrink: 0, borderRight: '1px solid #f0f0f0', paddingRight: 10}}>
            {groups.map((g) => {
              const latest = g[g.length - 1]
              return (
                <div key={latest.artifactCode} style={{marginBottom: 10}}>
                  <Text strong style={{fontSize: 13}}>{artifactDisplayName(latest)}</Text>
                  <div style={{fontSize: 12, color: '#999'}}>
                    {[formatArtifactSize(latest.sizeBytes), latest.kind, timeStr(latest.readyAt || latest.insertTime)].filter(Boolean).join(' · ')}
                  </div>
                  <Flex gap={4} wrap style={{marginTop: 2}}>
                    {g.map((v) => (
                      <Tag
                        key={v.artifactCode}
                        color={v.artifactCode === selected ? 'blue' : undefined}
                        style={{cursor: 'pointer'}}
                        onClick={() => openArtifact(v.artifactCode)}
                      >
                        v{Number.isFinite(Number(v.version)) ? Number(v.version) : '?'}
                        {v.state && v.state !== 'ready' ? ` ${v.state}` : ''}
                      </Tag>
                    ))}
                  </Flex>
                </div>
              )
            })}
          </div>
          <div style={{flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column'}}>
            {!selected ? <Empty description="选择左侧产物查看内容"/> : (
              <>
                <Flex justify="space-between" align="center" style={{marginBottom: 8}}>
                  <Text strong>{artifactDisplayName(selRow)}{selRow ? '' : '（不在本会话清单）'}</Text>
                  {selRow?.fileUrl ? <a href={selRow.fileUrl} target="_blank" rel="noreferrer"><Button size="small">下载原文件</Button></a> : null}
                </Flex>
                {readErr ? <Alert type="warning" showIcon message={readErr}/> : null}
                <div style={{flex: 1, overflow: 'auto', overflowWrap: 'anywhere'}}>
                  {loadingRead && !text ? <Spin/> : renderText(text)}
                </div>
                <Flex gap={8} style={{marginTop: 8}}>
                  {hasMore ? <Button size="small" loading={loadingRead} onClick={loadMore}>继续加载</Button> : null}
                  {typeof totalChars === 'number' ? (
                    <Text type="secondary" style={{fontSize: 12}}>
                      已载 {text.length.toLocaleString()} / {totalChars.toLocaleString()} 字符
                    </Text>
                  ) : null}
                </Flex>
              </>
            )}
          </div>
        </Flex>
      )}
    </Drawer>
  )
}

export default ArtifactWorkspace
