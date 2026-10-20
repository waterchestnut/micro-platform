/**
 * @fileOverview 长期记忆召回的放量闸门评测
 * @module evals/memory/recall.eval
 * @description 三条路线在同一份合成语料上对比：
 *   window        —— 现状：只带最近若干轮历史，什么都不记
 *   window@full   —— 朴素替代方案：把该记的事实全部塞进上下文（用来量"召回省了多少 token"）
 *   lexical       —— 当前实现的词法召回
 *   semantic      —— 语义召回（需嵌入服务；不可用则该路记为 SKIPPED，不伪造数字）
 *
 * 判定口径（写死在这里，避免事后解释）：
 *   命中 = 探针要求的字面片段出现在模型实际会收到的上下文文本里
 *   过时注入率 = 已退役事实被注入的比例，**否决指标**，必须为 0
 *   并存冲突率 = 同一主题的两代说法同时注入的比例（PR-5 已记录的短句漏判现象的代价）
 *   闸门 = 命中率相对 window 提升 >= +20pp，且 (window + 注入) 的 token 不超过 window@full 的 115%
 *
 * 用法：node evals/memory/recall.eval.js [--gate] [--no-semantic] [--users=N] [--pad=N] [--out=FILE]
 * 需要 dev Mongo/Redis 可达与嵌入服务；评测数据一律以 eval-mem 为前缀，跑完按前缀清干净。
 * `--pad` 控制每人附加的沉淀事实条数（默认 24），语料规模太小量不出召回相对"全量回放"的成本优势。
 */

import {buildCorpus, findFact, EVAL_CHANNEL, EVAL_USER_PREFIX} from './corpus.js'
import {embedTexts, cosine, embeddingAvailable, embeddingConfig} from './embed.js'

const argv = process.argv.slice(2)
const arg = (name, def) => {
    const hit = argv.find(_ => _.startsWith(`--${name}=`))
    return hit ? hit.split('=')[1] : (argv.includes(`--${name}`) ? true : def)
}
const GATE = argv.includes('--gate')
const USE_SEMANTIC = !argv.includes('--no-semantic')
const USERS = parseInt(arg('users', '6'))
const PAD = parseInt(arg('pad', '24'))
const OUT = typeof arg('out', '') === 'string' ? arg('out', '') : ''

await import('../../init.js')

const llmChannelDataSet = (await import('../../conf/llmChannel.js')).default
const {getChannelMemory} = await import('../../conf/llmChannel.js')
const {captureEvent} = await import('../../services/core/memory/capture.js')
const {recallForPrompt, composeRecall} = await import('../../services/core/memory/recall.js')
const {retireAtom} = await import('../../services/core/memory/api.js')
const {buildHistoryMessages} = await import('../../services/core/memory/assemble.js')
const {calcMessagesTokenCount, getTokenizerOptions} = await import('../../services/openai/util.js')
const {normalizeHit} = await import('../../services/core/memory/store/hit.js')
const memoryAtomDac = (await import('../../daos/core/dac/memoryAtomDac.js')).default
const memoryEventDac = (await import('../../daos/core/dac/memoryEventDac.js')).default
const memoryJournalDac = (await import('../../daos/core/dac/memoryJournalDac.js')).default
const memoryCandidateDac = (await import('../../daos/core/dac/memoryCandidateDac.js')).default
const memoryEntityDac = (await import('../../daos/core/dac/memoryEntityDac.js')).default
const memoryProfileDac = (await import('../../daos/core/dac/memoryProfileDac.js')).default
const memoryNamespaceDac = (await import('../../daos/core/dac/memoryNamespaceDac.js')).default
const redisClient = (await import('../../daos/cache/redisClient.js')).default

const RUN_TAG = Date.now().toString(36)
const TOK = getTokenizerOptions(llm.config.models.relay_common_flash)
const MEM_CFG = llm.config.memory || {}

const dacList = [memoryAtomDac, memoryEventDac, memoryJournalDac, memoryCandidateDac, memoryEntityDac, memoryProfileDac, memoryNamespaceDac]

/**
 * @description 按前缀清空历史评测数据与召回缓存
 */
async function purgeEvalData() {
    /** 用 RegExp 对象而不是 {$regex:...} 字面量：后者在 mongoose 查询强转里会被当成字符串值 */
    const re = new RegExp(`^${EVAL_USER_PREFIX}`)
    for (const dac of dacList) {
        await dac.destroyByFilter({userCode: re}).catch(e => console.log(`  清理失败: ${e.message}`))
    }
    try {
        const keys = await redisClient.getKeys(`mem:recall:${EVAL_USER_PREFIX}*`)
        for (const k of keys || []) {
            await redisClient.delValue(k)
        }
    } catch (e) {
        console.log(`  召回缓存清理跳过: ${e.message}`)
    }
}

/**
 * @description 灌入语料：走真实的 captureEvent 生成事件，再落原子（可回填历史时间戳）
 * @param {Object} corpus 语料
 */
async function seed(corpus) {
    let atoms = 0
    for (const user of corpus.users) {
        const curUserInfo = {userCode: user.userCode, realName: '评测用户'}
        for (const fact of user.facts) {
            const event = await captureEvent({
                curUserInfo,
                channel: EVAL_CHANNEL,
                conversationCode: `${user.userCode}-conv-seed`,
                messageCode: `${fact.factId}-msg`,
                role: 'user',
                content: fact.content,
                conversationType: 'normal',
                channelMemory: {enabled: true, capture: true},
            })
            const doc = {
                userCode: user.userCode,
                channel: EVAL_CHANNEL,
                kind: fact.kind,
                content: fact.content,
                topic: fact.topic,
                topics: [fact.topic],
                confidence: fact.confidence,
                source: fact.source,
                state: fact.state || 'active',
                evidence: [{
                    eventCode: event?.eventCode || null,
                    role: 'user',
                    quote: fact.content,
                    insertTime: fact.insertTime,
                }],
                insertTime: fact.insertTime,
                updateTime: fact.insertTime,
            }
            const created = await memoryAtomDac.add(doc)
            /** 退役事实走真实退役接口：它会一并降级证据事件，评测才有资格断言"过时注入=0" */
            if (fact.retired && created?.atomCode) {
                await retireAtom({userCode: user.userCode, realName: '评测用户'}, created.atomCode, EVAL_CHANNEL, 'eval_setup')
            }
            atoms++
        }
        await memoryNamespaceDac.add({userCode: user.userCode, channel: EVAL_CHANNEL, atomCount: user.facts.filter(f => !f.retired).length}).catch(() => null)
    }
    return atoms
}

/**
 * @description 百分位
 */
function p(items, q) {
    if (!items.length) {
        return 0
    }
    const s = [...items].sort((a, b) => a - b)
    return s[Math.min(s.length - 1, Math.floor(s.length * q))]
}

function avg(items) {
    return items.length ? items.reduce((a, b) => a + b, 0) / items.length : 0
}

function pct(n, d) {
    return d ? n / d : 0
}

/**
 * @description 窗口基线：只带最近历史
 */
function windowContext(user) {
    const docs = [...user.windowDocs].sort((a, b) => b.insertTime - a.insertTime)
    const messages = buildHistoryMessages(docs, {
        tokenizerOptions: TOK,
        maxTurns: llm.config.context?.historyMaxTurns ?? 10,
    }).messages
    const text = messages.map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n')
    return {text, tokens: calcMessagesTokenCount(messages, TOK)}
}

/**
 * @description 朴素替代方案：把该记的事实全部塞进上下文
 */
function stuffedContext(user, win) {
    const active = user.facts.filter(f => f.state !== 'retired')
    const messages = [
        ...buildHistoryMessages([...user.windowDocs].sort((a, b) => b.insertTime - a.insertTime), {tokenizerOptions: TOK}).messages,
        {role: 'user', content: `## 用户相关资料（全量回放）\n${active.map(f => `- ${f.content}`).join('\n')}`},
    ]
    const text = messages.map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n')
    return {text, tokens: calcMessagesTokenCount(messages, TOK)}
}

/**
 * @description 词法召回这一路
 */
async function lexicalLeg(user, probe) {
    const t0 = Date.now()
    const ret = await recallForPrompt({
        userCode: user.userCode,
        channel: EVAL_CHANNEL,
        query: probe.query,
        conversationCode: `${user.userCode}-conv-current`,
        tokenizerOptions: TOK,
    })
    return {text: ret.text, items: ret.items, tokens: ret.stats?.tokens ?? 0, ms: Date.now() - t0}
}

/**
 * @description 语义召回这一路：向量 topK 后接同一条下游管线
 */
async function semanticLeg(user, probe, vectors) {
    const qv = (await embedTexts([probe.query]))?.[0]
    if (!qv) {
        return null
    }
    const scored = user.facts
        .filter(f => f.state !== 'retired' && vectors.has(f.factId))
        .map(f => ({fact: f, sim: cosine(qv, vectors.get(f.factId))}))
        .sort((a, b) => b.sim - a.sim)
        .slice(0, MEM_CFG.recall?.topK ?? 12)
        .filter(s => s.sim >= 0.2)
    const hits = scored.map(s => normalizeHit({
        atomCode: s.fact.atomCode, content: s.fact.content, topic: s.fact.topic, kind: s.fact.kind,
        confidence: s.fact.confidence, source: s.fact.source, insertTime: s.fact.insertTime,
        score: s.sim,
    }))
    const t0 = Date.now()
    const composed = await composeRecall({
        atoms: hits,
        events: [],
        manualContext: '',
        currentConversationCode: `${user.userCode}-conv-current`,
        budget: MEM_CFG.recall?.tokens ?? 1500,
        tokenizerOptions: TOK,
        config: MEM_CFG,
    })
    return {text: composed.text, items: composed.items, tokens: composed.stats?.tokens ?? 0, ms: Date.now() - t0}
}

/**
 * @description 统计一路的指标
 */
function summarize(results) {
    const n = results.length
    const retiredInjected = results.filter(r => r.staleInjected).length
    return {
        probes: n,
        hitRate: pct(results.filter(r => r.hit).length, n),
        staleRate: pct(retiredInjected, n),
        conflictRate: pct(results.filter(r => r.conflict).length, results.filter(r => r.conflictApplicable).length),
        avgTokens: avg(results.map(r => r.tokens)),
        p95Tokens: p(results.map(r => r.tokens), 0.95),
        avgMs: avg(results.map(r => r.ms)),
        p95Ms: p(results.map(r => r.ms), 0.95),
        emptyButShouldHit: results.filter(r => !r.hit && !r.tokens).length,
    }
}

const fmt = x => (typeof x === 'number' ? (x < 1 && x > 0 ? `${(x * 100).toFixed(1)}%` : (Number.isInteger(x) ? String(x) : x.toFixed(1))) : String(x))

/* ============================ 主流程 ============================ */

console.log(`\n记忆召回评测 runTag=${RUN_TAG}`)
console.log(`  频道=${EVAL_CHANNEL} 模型计数口径=${TOK.tokenizer} 召回预算=${MEM_CFG.recall?.tokens} topK=${MEM_CFG.recall?.topK} 单源超时=${MEM_CFG.recall?.timeoutMs}ms`)

llmChannelDataSet[EVAL_CHANNEL].memory = {enabled: true, capture: true, recall: true}
llm.config.memory.enabled = true
console.log(`  灰度已在本进程内打开（配置仍为默认关闭）: ${JSON.stringify(getChannelMemory(EVAL_CHANNEL))}`)

console.log('\n[1/5] 清理历史评测数据')
await purgeEvalData()

console.log('\n[2/5] 灌入合成语料')
const corpus = buildCorpus({runTag: RUN_TAG, users: USERS, padFacts: PAD})
const seeded = await seed(corpus)
console.log(`  用户=${corpus.users.length} 事实=${seeded} 探针=${corpus.totalProbes}`)

/** 回填 atomCode（语料里的 factId 与库里 atomCode 对齐，供退役/冲突判定用） */
for (const user of corpus.users) {
    const rows = await memoryAtomDac.getTop(200, {userCode: user.userCode, channel: EVAL_CHANNEL})
    const byContent = new Map(rows.map(r => [r.content, r]))
    for (const fact of user.facts) {
        const row = byContent.get(fact.content)
        fact.atomCode = row?.atomCode || null
    }
}

let semanticUsable = USE_SEMANTIC
if (semanticUsable) {
    semanticUsable = await embeddingAvailable()
    const cfg = embeddingConfig()
    console.log(`\n[3/5] 语义路可用性：${semanticUsable ? `可用（${cfg.baseURL} / ${cfg.model} / ${cfg.dimensions}维）` : '不可用，该路记为 SKIPPED'}`)
} else {
    console.log('\n[3/5] 语义路：按参数跳过')
}

console.log('\n[4/5] 三向对比')
const buckets = {window: [], stuffed: [], lexical: [], semantic: []}
const vectorsCache = new Map()

for (const user of corpus.users) {
    const win = windowContext(user)
    const stuff = stuffedContext(user, win)
    const retiredFacts = user.facts.filter(f => f.retired)
    let vectors = new Map()
    if (semanticUsable) {
        if (!vectorsCache.has(user.userCode)) {
            const active = user.facts.filter(f => f.state !== 'retired')
            const vecs = await embedTexts(active.map(f => f.content))
            if (vecs) {
                active.forEach((f, i) => vectors.set(f.factId, vecs[i]))
            }
            vectorsCache.set(user.userCode, vectors)
        } else {
            vectors = vectorsCache.get(user.userCode)
        }
    }

    for (const probe of user.probes) {
        const gold = findFact(user, probe.goldFactId)
        const goldContent = probe.inWindow ? probe.goldSubstring : gold?.content || ''

        buckets.window.push({
            hit: win.text.includes(probe.goldSubstring),
            tokens: win.tokens, ms: 0,
            staleInjected: retiredFacts.some(f => win.text.includes(f.content)),
            conflict: false, conflictApplicable: false,
        })
        buckets.stuffed.push({
            hit: stuff.text.includes(probe.goldSubstring),
            tokens: stuff.tokens, ms: 0,
            staleInjected: retiredFacts.some(f => stuff.text.includes(f.content)),
            conflict: false, conflictApplicable: false,
        })

        const lex = await lexicalLeg(user, probe)
        const twin = probe.goldFactId?.endsWith('-subject-new') ? findFact(user, probe.goldFactId.replace('-new', '-old')) : null
        buckets.lexical.push({
            hit: lex.text.includes(probe.goldSubstring),
            tokens: lex.tokens, ms: lex.ms,
            staleInjected: retiredFacts.some(f => lex.text.includes(f.content)),
            conflict: Boolean(twin) && lex.text.includes(twin.content),
            conflictApplicable: Boolean(twin),
            goldContent,
        })

        if (semanticUsable) {
            const sem = await semanticLeg(user, probe, vectors)
            if (sem) {
                buckets.semantic.push({
                    hit: sem.text.includes(probe.goldSubstring),
                    tokens: sem.tokens, ms: sem.ms,
                    staleInjected: retiredFacts.some(f => sem.text.includes(f.content)),
                    conflict: Boolean(twin) && sem.text.includes(twin.content),
                    conflictApplicable: Boolean(twin),
                    goldContent,
                })
            }
        }
    }
}

const stats = {
    window: summarize(buckets.window),
    stuffed: summarize(buckets.stuffed),
    lexical: summarize(buckets.lexical),
    semantic: buckets.semantic.length ? summarize(buckets.semantic) : null,
}

const pad = (s, n) => String(s).padEnd(n)
console.log('\n  ' + pad('路线', 12) + pad('命中率', 9) + pad('过时注入', 9) + pad('冲突并存', 9) + pad('均token', 9) + pad('p95token', 9) + pad('p95ms', 8))
console.log('  ' + '-'.repeat(66))
for (const [name, s] of Object.entries(stats)) {
    if (!s) {
        console.log('  ' + pad(name, 12) + 'SKIPPED')
        continue
    }
    console.log('  ' + pad(name, 12) + pad(fmt(s.hitRate), 9) + pad(fmt(s.staleRate), 9) + pad(fmt(s.conflictRate), 9) + pad(fmt(Math.round(s.avgTokens)), 9) + pad(fmt(Math.round(s.p95Tokens)), 9) + pad(fmt(Math.round(s.p95Ms)), 8))
}

console.log(`\n  词法召回空返回但本应有内容: ${stats.lexical.emptyButShouldHit} 例（多为单源超时或探针与事实无共同字面片段）`)

console.log('\n[5/5] 放量闸门')
const results = []
for (const name of ['lexical', 'semantic']) {
    const s = stats[name]
    if (!s) {
        console.log(`  ${name}: SKIPPED（不参与闸门）`)
        continue
    }
    const deltaHit = s.hitRate - stats.window.hitRate
    const costRatio = (stats.window.avgTokens + s.avgTokens) / (stats.stuffed.avgTokens || 1)
    const g1 = deltaHit >= 0.20
    const g2 = costRatio <= 1.15
    const g3 = s.staleRate === 0
    results.push({name, deltaHit, costRatio, g1, g2, g3, pass: g1 && g2 && g3})
    console.log(`  ${name}:`)
    console.log(`    命中率 ${fmt(s.hitRate)} vs 窗口 ${fmt(stats.window.hitRate)} → Δ ${deltaHit >= 0 ? '+' : ''}${(deltaHit * 100).toFixed(1)}pp  需>=+20pp  ${g1 ? 'PASS' : 'FAIL'}`)
    console.log(`    成本 (窗口 ${fmt(Math.round(stats.window.avgTokens))} + 注入 ${fmt(Math.round(s.avgTokens))}) / 全量回放 ${fmt(Math.round(stats.stuffed.avgTokens))} = ${(costRatio * 100).toFixed(1)}%  需<=115%  ${g2 ? 'PASS' : 'FAIL'}`)
    console.log(`    过时注入率 ${fmt(s.staleRate)}  需=0（否决项）  ${g3 ? 'PASS' : 'FAIL'}`)
    console.log(`    p95 延迟 ${fmt(Math.round(s.p95Ms))}ms  冲突并存率 ${fmt(s.conflictRate)}`)
}

if (OUT) {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const abs = path.resolve(OUT)
    await fs.mkdir(path.dirname(abs), {recursive: true})
    await fs.writeFile(abs, JSON.stringify({runTag: RUN_TAG, corpus: {users: corpus.users.length, facts: seeded, probes: corpus.totalProbes}, stats, gate: results}, null, 2), 'utf-8')
    console.log(`\n  报告已写入 ${abs}`)
}

console.log('\n清理评测数据')
await purgeEvalData()
delete llmChannelDataSet[EVAL_CHANNEL].memory
const left = await memoryAtomDac.getCount({userCode: new RegExp(`^${EVAL_USER_PREFIX}`)})
console.log(`  残留 atom=${left}`)

const failed = results.filter(r => !r.pass)
if (GATE) {
    if (!results.length) {
        console.log('\n闸门未通过：没有任何参与闸门的路线')
        process.exit(2)
    }
    if (failed.length) {
        console.log(`\n闸门 FAIL：${failed.map(f => f.name).join(', ')}`)
        process.exit(1)
    }
    console.log('\n闸门 PASS：允许进入 PR-8 灰度')
} else {
    console.log(`\n未带 --gate，仅作观测${failed.length ? `（${failed.map(f => f.name).join(', ')} 未达标）` : ''}`)
}
process.exit(0)
