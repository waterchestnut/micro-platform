#!/usr/bin/env node
/**
 * @fileOverview RAG 检索评估运行器（召回侧指标：hit@k / MRR / 相似度分布）
 * 用法: node evals/run.mjs <accessToken> [--file evals/questions.json] [--top 15] [--verbose]
 * 说明: 通过 dev 网关调 /rag/api/core/rag-search/search，对每题统计
 *   - hit@5 / hit@15 : 期望证据(关键词任一)是否出现在前 k 条返回段落
 *   - MRR            : 首个命中段落排名倒数均值
 *   - sim 分布        : 各题最高 _sim（校准 0.56 下限是否过松/过紧）
 * 结果落 evals/out/<时间戳>.json，作为 rerank/hybrid 改造的对照基线。
 */
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const GW = process.env.RAG_EVAL_GATEWAY || 'https://api.xxzx.paretop.net'
const tok = process.argv[2]
if (!tok) { console.error('用法: node run.mjs <accessToken> [--file q.json] [--verbose]'); process.exit(1) }
const fileArg = process.argv.indexOf('--file')
const qFile = fileArg > 0 ? process.argv[fileArg + 1] : path.join(path.dirname(fileURLToPath(import.meta.url)), 'questions.json')
const verbose = process.argv.includes('--verbose')

const questions = JSON.parse(fs.readFileSync(qFile, 'utf8')).filter(q => q.query)

async function search(query, ragCode) {
    const r = await fetch(`${GW}/rag/core/rag-search/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: `param-accessToken=${tok}` },
        body: JSON.stringify({ subject: query, options: { maxLength: 15, withChunks: 0, ...(ragCode ? { ragCode } : {}) } }),
    })
    if (!r.ok) throw new Error(`HTTP ${r.status} ${query.slice(0, 20)}`)
    const d = await r.json()
    return d.data || []
}

const hitRank = (segs, expectKeywords) => {
    for (let i = 0; i < segs.length; i++) {
        const content = segs[i].content || ''
        if (expectKeywords.some(k => content.includes(k))) return i + 1
    }
    return 0
}

const results = []
for (const q of questions) {
    try {
        const segs = await search(q.query, q.ragCode)
        const rank = hitRank(segs, q.expectKeywords || [])
        const topSim = segs.length ? Math.max(...segs.map(_ => _.similarity || 0)) : 0
        results.push({ id: q.id, query: q.query, returned: segs.length, rank, hit5: rank > 0 && rank <= 5, hit15: rank > 0, topSim: Number(topSim.toFixed(4)), topRerank: Math.max(0, ...segs.map(_ => _.rerankScore || 0)) })
        if (verbose) console.log(`  [${q.id}] rank=${rank || '-'} sim=${topSim.toFixed(3)} n=${segs.length}`)
    } catch (e) {
        results.push({ id: q.id, query: q.query, error: e.message })
    }
    await new Promise(r => setTimeout(r, 400))
}

const ok = results.filter(_ => !_.error)
const n = ok.length || 1
const summary = {
    total: results.length, errors: results.length - ok.length,
    hitAt5: (ok.filter(_ => _.hit5).length / n).toFixed(3),
    hitAt15: (ok.filter(_ => _.hit15).length / n).toFixed(3),
    mrr: (ok.reduce((a, _) => a + (_.rank ? 1 / _.rank : 0), 0) / n).toFixed(3),
    simMaxAvg: (ok.reduce((a, _) => a + (_.topSim || 0), 0) / n).toFixed(3),
    zeroHit: ok.filter(_ => !_.rank).map(_ => _.id),
}
console.log('\n===== RAG 检索评估 =====')
console.log(JSON.stringify(summary, null, 1))
fs.mkdirSync('evals/out', { recursive: true })
const outFile = path.join('evals/out', new Date().toISOString().replace(/[:.]/g, '-') + '.json')
fs.writeFileSync(outFile, JSON.stringify({ at: new Date().toISOString(), summary, results }, null, 1))
console.log('明细 →', outFile)
