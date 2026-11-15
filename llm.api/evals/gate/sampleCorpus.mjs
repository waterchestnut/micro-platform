/**
 * @fileOverview 门评测的语料取样共享件（合成流量排除名单的**权威处**）
 * @module evals/gate/sampleCorpus
 * @description
 * 排除名单此前在 p11-action-census 与 p11-classifier-cost 各抄一份——第三处要用时收编，
 * 否则"哪些会话不算自然流量"会在三个文件里长成三种理解（两份同值分家家族的第三次点名）。
 * mongo/relay 配置都是重依赖：本模块**惰性取**（getSchema 首调才 import init.js），
 * 离线用例 import 纯函数不触发任何连接。
 */

/** 合成流量前缀清单：与本仓探针/跑批实际写入的 conversationCode 对账；新增写手要同步进来 */
export const SYNTH_PREFIXES = ['eval-golden-', 'art-e2e-', 'ctl-e2e-', 'ask-e2e-', 'gate3-check-', 'gate4-check-',
    'h1-args-', 'prh2-probe', 'aab-', 'toktest-', 'p11-', 'plan-e2e-', 'resume-', 'seg-', 'b2-']

export function isSynthetic(code = '') {
    return SYNTH_PREFIXES.some((p) => String(code || '').startsWith(p))
}

let schemaP = null
/** 惰性载 schema（init.js 只跑一次；ESM 缓存保证幂等） */
export async function getSchema() {
    if (!schemaP) {
        await import(new URL('../../init.js', import.meta.url).href)
        schemaP = await import(new URL('../../daos/core/schema/index.js', import.meta.url).href)
    }
    return schemaP
}

/**
 * @description 取自然流量的工具调用样本（与普查同判据：progress=finish、排除合成前缀）
 * @param {Object} [opts] {days, limit}
 * @returns {Promise<{toolName:String, argText:String, conversationCode:String, insertTime:Date}[]>}
 */
export async function loadNaturalToolCalls({days = 45, limit = 3000} = {}) {
    const {Message} = await getSchema()
    const since = new Date(Date.now() - days * 86400000)
    const rows = await Message.find({
        insertTime: {$gte: since}, progress: 'finish', 'extInfo.toolCalls.0': {$exists: true},
    }, {'extInfo.toolCalls': 1, conversationCode: 1, insertTime: 1}).sort({insertTime: -1}).limit(limit).lean()
    const out = []
    for (const r of rows) {
        if (isSynthetic(r.conversationCode)) {
            continue
        }
        for (const tc of r.extInfo?.toolCalls || []) {
            const raw = tc.args ?? tc.arguments
            const argText = typeof raw === 'string' ? raw : (raw ? JSON.stringify(raw) : '')
            out.push({toolName: String(tc.name || ''), argText, conversationCode: r.conversationCode, insertTime: r.insertTime})
        }
    }
    return out
}

/** 正文脱敏摘要：审阅分歧条目时按 hash 回档案 grep，**报告里永不出现正文** */
export function argHash(text = '') {
    let h = 5381
    const s = String(text)
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) + h + s.charCodeAt(i)) | 0
    }
    return `djb2-${(h >>> 0).toString(16)}`
}

export default {SYNTH_PREFIXES, isSynthetic, getSchema, loadNaturalToolCalls, argHash}
