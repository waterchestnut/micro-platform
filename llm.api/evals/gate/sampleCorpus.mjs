/**
 * @fileOverview 门评测的语料取样共享件（合成流量判别的**权威处**）
 * @module evals/gate/sampleCorpus
 * @description
 * 判别的权威史：前缀清单先立（census/cost 各抄一份后收编于此），但 2026-11-15 的
 * 前缀×用户交叉盘点证明**前缀追不上写手速度**——60 天档案里每一条工具调用都来自探针身份，
 * 首版 census 的"自然分布"（network-fetch 14× shell）整个是压测形状。
 * 于是主判据换成 **operator.userCode**（探针/跑批的身份是有限可命名的集合），前缀降为次判据。
 * 代价如实记：管理员(menglb)的真实聊天会被一并排除——宁可少样本，不可污染分布；
 * excludedBy.user 就是这条规则吃掉的上限，报告侧显形不静默。
 * mongo 是重依赖：惰性取（getSchema 首调才 import init.js），离线用例 import 纯函数不触发连接。
 */

/** 合成流量前缀清单（次判据）：与本仓探针/跑批实际写入的 conversationCode 对账 */
export const SYNTH_PREFIXES = ['eval-golden-', 'art-e2e-', 'ctl-e2e-', 'ask-e2e-', 'gate3-check-', 'gate4-check-',
    'h1-args-', 'prh2-probe', 'aab-', 'toktest-', 'p11-', 'plan-e2e-', 'resume-', 'seg-', 'b2-']

export function isSynthetic(code = '') {
    return SYNTH_PREFIXES.some((p) => String(code || '').startsWith(p))
}

/** 探针/跑批的自述身份（userCode 主判据）：跑批口令 menglb + 各类 *-probe/*-verify/*-smoke 风格账号 */
const SYNTH_USERS_EXACT = new Set(['menglb'])
const SYNTH_USERS_RE = /(probe|verify|smoke|trust|regression|^gap\d|^attr-|^cancel-)/i

/**
 * @description 合成判别：'prefix'|'user'|null（原因分开计数，清单过期与身份漏网是两种失效）
 * @param {String} code conversationCode
 * @param {String} userCode operator.userCode
 * @returns {String|null}
 */
export function syntheticReason(code = '', userCode = '') {
    if (isSynthetic(code)) {
        return 'prefix'
    }
    const u = String(userCode || '')
    if (SYNTH_USERS_EXACT.has(u) || SYNTH_USERS_RE.test(u)) {
        return 'user'
    }
    return null
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
 * @description 取自然流量的工具调用样本（主=用户、次=前缀；排除按原因计数）
 * @param {Object} [opts] {days, limit}
 * @returns {Promise<{samples: Object[], scanned: Number, excludedBy: {prefix: Number, user: Number}}>}
 */
export async function loadNaturalToolCalls({days = 45, limit = 3000} = {}) {
    const {Message} = await getSchema()
    const since = new Date(Date.now() - days * 86400000)
    const rows = await Message.find({
        insertTime: {$gte: since}, progress: 'finish', 'extInfo.toolCalls.0': {$exists: true},
    }, {'extInfo.toolCalls': 1, conversationCode: 1, 'operator.userCode': 1}).sort({insertTime: -1}).limit(limit).lean()
    const samples = []
    const excludedBy = {prefix: 0, user: 0}
    for (const r of rows) {
        const why = syntheticReason(r.conversationCode, r.operator?.userCode)
        if (why) {
            excludedBy[why] = (excludedBy[why] || 0) + 1
            continue
        }
        for (const tc of r.extInfo.toolCalls || []) {
            const raw = tc.args ?? tc.arguments
            const argText = typeof raw === 'string' ? raw : (raw ? JSON.stringify(raw) : '')
            samples.push({toolName: String(tc.name || ''), argText, argsChars: Number.isFinite(Number(tc.argsChars)) && tc.argsChars !== undefined ? Number(tc.argsChars) : null,
                conversationCode: r.conversationCode, insertTime: r.insertTime})
        }
    }
    return {samples, scanned: rows.length, excludedBy}
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

export default {SYNTH_PREFIXES, isSynthetic, syntheticReason, getSchema, loadNaturalToolCalls, argHash}
