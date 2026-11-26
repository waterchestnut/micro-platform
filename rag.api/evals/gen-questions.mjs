#!/usr/bin/env node
/**
 * @fileOverview 从库内真实材料半自动生成评估问题集（LLM 出题 + 关键词回标期望段）
 * 用法: node evals/gen-questions.mjs <accessToken> [--per-material 2] [--limit 10]
 * 流程: 取样材料 → 原文切段 → xinference chat 依段出题 → 题面关键词回标 segment → questions.draft.json
 * 产物是草稿：人工筛选后才进 questions.json（垃圾题比没题更坏）。
 */
import fs from 'node:fs'

const GW = process.env.RAG_EVAL_GATEWAY || 'https://api.xxzx.paretop.net'
const CHAT = process.env.RAG_EVAL_CHAT || 'http://192.168.31.127:3009/v1'
const CHAT_MODEL = process.env.RAG_EVAL_CHAT_MODEL || 'qwen3'
const tok = process.argv[2]
if (!tok) { console.error('用法: node gen-questions.mjs <accessToken>'); process.exit(1) }
const perArg = process.argv.indexOf('--per-material')
const perMaterial = perArg > 0 ? parseInt(process.argv[perArg + 1]) : 2
const limArg = process.argv.indexOf('--limit')
const limit = limArg > 0 ? parseInt(process.argv[limArg + 1]) : 10

/** 管理端接口（ipmi 系列为 POST body 过滤，路径以 routes/core/rag-info/ipmi-*.js 为准） */
async function api(pathname, body = {}) {
    const r = await fetch(GW + pathname, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: `param-accessToken=${tok}` },
        body: JSON.stringify(body),
    })
    if (!r.ok) throw new Error(`${pathname} HTTP ${r.status}`)
    return (await r.json()).data
}

async function askLLM(prompt) {
    const r = await fetch(`${CHAT}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: CHAT_MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: 400 }),
    })
    if (!r.ok) throw new Error(`LLM HTTP ${r.status}`)
    const d = await r.json()
    return d.choices?.[0]?.message?.content || ''
}

const materials = (await api('/rag/core/rag-info/ipmi-material/list', { pageIndex: 1, pageSize: limit })).rows || []
const drafts = []
for (const m of materials.slice(0, limit)) {
    const detail = m.details?.find(_ => _.isOriginal) || m.details?.[0]
    const text = (detail?.text || '').slice(0, 2200)
    if (text.length < 200) continue
    let segs = []
    try {
        segs = (await api('/rag/core/rag-info/ipmi-segment/list', { pageIndex: 1, pageSize: 50, filter: { ragMaterialCode: m.ragMaterialCode } })).rows || []
    } catch (e) { continue }
    if (!segs.length) continue
    const out = await askLLM(`以下是《${m.resTitle || m.ragMaterialCode}》的一段正文。请生成 ${perMaterial} 个读者真实会问的中文问题（不要"本文/文中"字样），每行一个，另起一行对每题给出 2-4 个"答案所在段落必须包含的关键词"（逗号分隔，须原样出现在正文）。格式：Q: 问题\nK: 关键词1,关键词2\n\n正文：${text}`)
    const qs = [...out.matchAll(/Q:\s*(.+)\nK:\s*(.+)/g)]
    for (const [, query, kws] of qs) {
        const keys = kws.split(/[,，]/).map(s => s.trim()).filter(Boolean)
        const hit = segs.find(s => keys.every(k => (s.content || '').includes(k)))
        if (!hit) continue
        drafts.push({ id: `${m.sourceType || m.ragMaterialCode.slice(0, 8)}-${drafts.length + 1}`, query: query.trim(), expectKeywords: keys, ragMaterialCode: m.ragMaterialCode, note: 'LLM 生成待人工筛' })
    }
    await new Promise(r => setTimeout(r, 800))
}
fs.writeFileSync('evals/questions.draft.json', JSON.stringify(drafts, null, 1))
console.log(`草稿 ${drafts.length} 题 → evals/questions.draft.json（人工筛选后合并进 questions.json）`)
