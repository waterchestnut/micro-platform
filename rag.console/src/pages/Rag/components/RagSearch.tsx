import React, {useState} from 'react'
import {Button, Card, Empty, Input, InputNumber, Select, Space, Spin, Tag, Tooltip, Typography} from 'antd'
import {history} from '@@/core/history'
import {SearchOutlined, ThunderboltOutlined} from '@ant-design/icons'
import {vecSearch} from '@/services/rag/ragSearch'
import {simBadge} from '../ragMeta'

export type RagSearchProps = {
  pRagInfo?: any;
  apiRelativeUrls?: any;
  toMaterialDetail?: (ragCode: string, ragMaterialCode: string) => void;
};

const RagSearch: React.FC<RagSearchProps> = (props) => {
  const {pRagInfo, toMaterialDetail} = props
  const [query, setQuery] = useState('')
  const [maxLength, setMaxLength] = useState(10)
  const [minSimilarity, setMinSimilarity] = useState<number | null>(null)
  const [withChunks, setWithChunks] = useState(true)
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<any[] | null>(null)
  const [elapsed, setElapsed] = useState(0)

  const doSearch = async (subject?: string) => {
    const q = (subject ?? query).trim()
    if (!q) return
    if (subject !== undefined) setQuery(q)
    setLoading(true)
    try {
      const t0 = performance.now()
      const options: any = {
        withChunks: withChunks ? 1 : 0,
        ragCode: pRagInfo?.ragCode,
        maxLength,
      }
      if (minSimilarity !== null && minSimilarity > 0) options.minSimilarity = minSimilarity
      const data = await vecSearch(q, options)
      setElapsed(Math.round(performance.now() - t0))
      setResults(data || [])
    } finally {
      setLoading(false)
    }
  }

  const toMaterial = (record: any) => {
    if (!record.ragMaterialCode) return
    if (toMaterialDetail) {
      toMaterialDetail(record.ragCode, record.ragMaterialCode)
    } else {
      history.push(`${location.pathname.startsWith('/lite/') ? '/lite' : ''}/rag/detail/${record.ragCode}/${record.ragMaterialCode}`)
    }
  }

  const avgSim = results?.length
    ? (results.reduce((a, r) => a + (typeof r.similarity === 'number' ? r.similarity : 0), 0) / results.length).toFixed(3)
    : null

  return (
    <div>
      <Card style={{borderRadius: 12, marginBottom: 16}} styles={{body: {padding: 20}}}>
        <Input.TextArea
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder='输入问题或关键词，测试知识库召回效果'
          autoSize={{minRows: 2, maxRows: 5}}
          onPressEnter={e => {
            if (e.ctrlKey || e.metaKey) doSearch()
          }}
        />
        <Space wrap style={{marginTop: 12}}>
          <span style={{fontSize: 13, color: 'rgba(0,0,0,0.65)'}}>召回数</span>
          <Select
            value={maxLength}
            style={{width: 90}}
            onChange={setMaxLength}
            options={[5, 10, 15, 30].map(v => ({label: String(v), value: v}))}
          />
          <span style={{fontSize: 13, color: 'rgba(0,0,0,0.65)'}}>相似度下限</span>
          <InputNumber
            value={minSimilarity ?? undefined}
            placeholder='默认 0.56'
            min={0}
            max={1}
            step={0.02}
            style={{width: 110}}
            onChange={v => setMinSimilarity(v === null || v === undefined ? null : Number(v))}
          />
          <span style={{fontSize: 13, color: 'rgba(0,0,0,0.65)'}}>
            <input type='checkbox' checked={withChunks} onChange={e => setWithChunks(e.target.checked)} style={{marginRight: 4}}/>
            显示命中分句
          </span>
          <Button type='primary' icon={<SearchOutlined/>} loading={loading} onClick={() => doSearch()}>检索</Button>
        </Space>
        {!!pRagInfo?.recommendedQuestions?.length && (
          <div style={{marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center'}}>
            <span style={{fontSize: 12, color: 'rgba(0,0,0,0.45)'}}>推荐问题：</span>
            {pRagInfo.recommendedQuestions.map((q: string, i: number) => (
              <Tag key={i} style={{cursor: 'pointer'}} onClick={() => doSearch(q)}>{q}</Tag>
            ))}
          </div>
        )}
      </Card>

      {results === null ? (
        <Card style={{borderRadius: 12}}>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={<span>输入问题开始测试；Ctrl+Enter 也可触发检索<br/>召回结果将展示相似度，低于下限的语料会被过滤</span>}
          />
        </Card>
      ) : loading ? (
        <Card style={{borderRadius: 12, textAlign: 'center', padding: '40px 0'}}><Spin/></Card>
      ) : results.length === 0 ? (
        <Card style={{borderRadius: 12}}>
          <Empty description={<span>未召回任何分段。可尝试：换一种提问方式、降低相似度下限、确认材料已处理完成且启用</span>}/>
        </Card>
      ) : (
        <>
          <Space style={{marginBottom: 12}} wrap>
            <Tag color='blue' bordered={false}>召回 {results.length} 段</Tag>
            {avgSim ? <Tag bordered={false}>平均相似度 {avgSim}</Tag> : null}
            <Tag bordered={false}>耗时 {elapsed}ms</Tag>
            {results.some(r => typeof r.rerankScore === 'number') ? <Tag color='purple' bordered={false}><ThunderboltOutlined/> 精排已启用</Tag> : null}
          </Space>
          <div style={{display: 'flex', flexDirection: 'column', gap: 12}}>
            {results.map((record, idx) => {
              const badge = simBadge(record.similarity)
              return (
                <Card key={record.ragSegmentCode || idx} style={{borderRadius: 12}} styles={{body: {padding: 16}}}>
                  <div style={{display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8}}>
                    <Tag bordered={false} color={idx === 0 ? 'geekblue' : 'default'} style={{fontFamily: 'monospace'}}>#{idx + 1}</Tag>
                    {badge ? <Tag color={badge.color} bordered={false}>{badge.text}</Tag> : null}
                    {typeof record.rerankScore === 'number' ? <Tag color='purple' bordered={false}>精排 {record.rerankScore.toFixed(3)}</Tag> : null}
                    <Typography.Text style={{fontWeight: 500, flex: 1, minWidth: 120}} ellipsis={{tooltip: record.resTitle}}>
                      <a onClick={() => toMaterial(record)}>{record.resTitle || '未知材料'}</a>
                    </Typography.Text>
                    <span style={{fontSize: 12, color: 'rgba(0,0,0,0.45)'}}>
                      S-{record.position} · {record.wordCount ?? 0}字符 · {record.tokens ?? 0}tokens
                    </span>
                  </div>
                  <Typography.Paragraph
                    style={{marginBottom: record.chunks?.length ? 8 : 0, fontSize: 13, lineHeight: 1.7}}
                    ellipsis={{rows: 4, expandable: 'collapsible', symbol: '展开'}}
                    copyable
                  >
                    {record.content}
                  </Typography.Paragraph>
                  {!!record.chunks?.length && (
                    <details style={{fontSize: 12}}>
                      <summary style={{cursor: 'pointer', color: 'rgba(0,0,0,0.45)', marginBottom: 6}}>命中分句（{record.chunks.length}）</summary>
                      <div style={{display: 'flex', flexDirection: 'column', gap: 6, background: 'rgba(0,0,0,0.02)', borderRadius: 8, padding: 10}}>
                        {record.chunks.map((c: any, ci: number) => {
                          const cb = simBadge(typeof c.similarity === 'number' ? c.similarity : c._sim)
                          return (
                            <div key={c.ragChunkCode || ci} style={{display: 'flex', gap: 8, alignItems: 'baseline'}}>
                              <span style={{fontFamily: 'monospace', color: 'rgba(0,0,0,0.45)', flexShrink: 0}}>C-{c.position}</span>
                              {cb ? <Tag color={cb.color} bordered={false} style={{flexShrink: 0, fontSize: 11}}>{cb.text}</Tag> : null}
                              <Typography.Text style={{fontSize: 12}} ellipsis={{tooltip: c.content}}>{c.content}</Typography.Text>
                            </div>
                          )
                        })}
                      </div>
                    </details>
                  )}
                </Card>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

export default RagSearch
