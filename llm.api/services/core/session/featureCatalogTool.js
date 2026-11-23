/**
 * @fileOverview platform_features 检索工具（platform-feature-map Phase 1 刀2，IO 壳+工具三件套）
 * @module services/core/session/featureCatalogTool
 * @description
 * buildFeatureCatalogTools / isFeatureCatalogTool / executeFeatureCatalogSearch——
 * buildXxxTools 家族形状（readAttachmentTool 同法）。壳只做四件事，判定全转调：
 *   读目录行（装配资格判据转调 skillGovernance，不抄第二份）→ 权限合取过滤（featureAccess
 *   两层判据+批量 hasPriv，V8）→ 检索打分（featureSearch）→ 返回/V7 分态。
 * 性格钉三条：
 * 1. **fail-closed 但如实分态（V7）**：hasPriv RPC 炸 ⇒ 返回 permission-service-unavailable
 *    （"暂时无法确认功能权限"），绝不洗成"平台没有功能"——fail-closed 是安全属性，错话不是；
 *    批量判定失败时**不产 granted 表跑全拒路径**（全拒=把故障读成"全员无权限"=同一个 oracle 泄漏）。
 * 2. **审计 log-and-forget（错误不殃及检索）**：auditSink 缺席/抛错只 warn；写失败不影响 matched。
 * 3. **deps 注入面**（runFollowLoop/recoverCandidate 家规）：readCatalogRows/fetchGrants/auditSink
 *    可注入——真跑用例不靠读文本，dev 库真行探针同一入口。
 */
import { normalizeFeatureEntry, decideFeatureAccess } from './featureAccess.js'
import { searchFeatures } from './featureSearch.js'

const logger = llm.logger

export const FEATURE_SEARCH_TOOL_NAME = 'platform_features'

/** 工具定义（description 里不枚举子系统——枚举=全目录披露的另一种形态；方向感由检索结果给出） */
export function buildFeatureCatalogTools() {
    return [{
        type: 'function',
        function: {
            name: FEATURE_SEARCH_TOOL_NAME,
            description: '检索平台功能目录。当用户需求可能由平台某个子系统/功能满足（做某件事、找某个入口、查某类数据）时调用；'
                + '返回功能条目的名称、用途说明与平台入口。引用只出自本工具结果，目录没有的功能如实说没有，禁止编造功能或入口。',
            parameters: {
                type: 'object',
                properties: {
                    keyword: { type: 'string', description: '用户意图关键词（自然语言短语即可）' },
                },
                required: ['keyword'],
            },
        },
    }]
}

export function isFeatureCatalogTool(name) {
    return name === FEATURE_SEARCH_TOOL_NAME
}

/**
 * @description 执行检索（IO 壳）。返回 JSON 串（工具回包形状），两种失败态与成功态互斥：
 *  - 成功：{matched:[...], total, hint?}——hint 仅 matched=0 时给统一措辞（V4：miss 不分因）
 *  - 权限服务不可用：{status:'permission-service-unavailable', hint}（V7）
 * @param {Object} p
 * @param {String} p.keyword 检索词
 * @param {String} p.userCode 会话身份（防线判定的唯一主体，B0-1 同源）
 * @param {String} p.channel 当前频道（目录 channels 绑定过滤）
 * @param {Object} [p.deps] 注入面 {readCatalogRows, fetchGrants, auditSink, topK, now}
 * @returns {Promise<String>} 工具回包
 */
export async function executeFeatureCatalogSearch({keyword = '', userCode = '', channel = '', conversationCode = '', runCode = '', deps = {}} = {}) {
    const {
        readCatalogRows = defaultReadCatalogRows,
        fetchGrants = defaultFetchGrants,
        auditSink = defaultAuditSink,
        topK = (llm.config.featureCatalog || {}).searchTopK || 5,
    } = deps

    let rows = []
    try {
        rows = await readCatalogRows({ channel })
    } catch (e) {
        logger.warn(`功能目录读取失败(检索如实报不可用): ${String(e?.message || e).slice(0, 200)}`)
        return finish(auditSink, {kind: 'search', userCode, conversationCode, runCode, channel, keyword, status: 'catalog-unreadable', decision: 'unavailable'},
            JSON.stringify({ status: 'catalog-unreadable', hint: '功能目录暂时不可用，稍后再试；请勿据此推断平台没有相关功能。' }))
    }

    // 装配资格与哈希核对**转调 grpcSkill 现成管道**（getGrpcSkillsByChannel：eligible+hash+
    // 剔除打回一条龙，PR-E0.1 在架）——本壳不重抄第二份资格判据（同源纪律；重抄=分叉）
    const candidates = rows
        .filter((r) => r)
        .map((r) => ({ raw: r, entry: normalizeFeatureEntry(r) }))

    // 两层合取（V8 批量）：needPrivs 全集去重一次取
    const needPrivs = []
    for (const c of candidates) {
        if (c.entry.browseGate !== false) needPrivs.push(`${c.entry.clientCode}-browse`)
        for (const p of (c.entry.featurePrivs || [])) { if (typeof p === 'string' && p.trim()) needPrivs.push(p.trim()) }
    }
    let granted = null
    try {
        granted = await fetchGrants({ userCode, privs: [...new Set(needPrivs)] })
    } catch (e) {
        // V7：RPC 炸不跑"全拒"路径——故障与无权限必须两态（后者会把"你没权限"泄漏成推断面）
        logger.warn(`目录权限判定不可用(userCode=${userCode}): ${String(e?.message || e).slice(0, 160)}`)
        return finish(auditSink, {kind: 'search', userCode, conversationCode, runCode, channel, keyword, status: 'permission-service-unavailable', decision: 'unavailable'},
            JSON.stringify({ status: 'permission-service-unavailable', hint: '暂时无法确认功能权限，请稍后重试。' }))
    }

    const visible = []
    for (const c of candidates) {
        const d = decideFeatureAccess({ entry: c.entry, granted })
        if (d.allow) {
            visible.push({
                skillCode: c.raw.skillCode || '',
                title: c.raw.skillName || '',
                description: describeOf(c.raw),
                clientCode: c.entry.clientCode,
                menuPath: (c.raw.entry && c.raw.entry.menuPath) || '',
                entry: c.raw.entry,
                effectClass: c.entry.effectInfo.passthrough ? 'read' : (c.entry.effect || 'guide'), // W6：存量直通按 read（V10 迁移前不降级现网调用面）
            })
        }
    }

    const res = searchFeatures({ entries: visible, keyword, topK })
    const out = { matched: res.matched, total: res.total }
    if (!res.matched.length) out.hint = '平台当前没有与此匹配的已上线功能；请如实告知用户，不要编造功能或入口，也不要据此断言平台不存在该能力（可能权限服务刚恢复后另有可见项）。'
    await finishAsync(auditSink, {
        kind: 'search', userCode, conversationCode, runCode, channel, keyword, status: 'ok', decision: 'ok',
        matchedCount: res.matched.length, visibleCount: visible.length,
        matched: res.matched.map((m) => m.skillCode), grantedCount: Object.keys(granted || {}).length,
    })
    return JSON.stringify(out)
}

/** 目录条目面向模型的说明文本：skillMD frontmatter.description 优先，退 skillName（不现编） */
function describeOf(row) {
    const md = String(row.skillMD || '')
    const m = md.match(/^---[\s\S]*?\ndescription:\s*(.+)[\s\S]*?---/)
    const d = m ? m[1].trim().replace(/^["']|["']$/g, '') : ''
    return d || row.skillName || ''
}

function finish(auditSink, rec, ret) {
    finishAsync(auditSink, rec).catch(() => {})
    return ret
}
async function finishAsync(auditSink, rec) {
    if (typeof auditSink !== 'function') return
    try { await auditSink(rec) } catch (e) {
        logger.warn(`功能目录审计写入失败(不殃及检索): ${String(e?.message || e).slice(0, 160)}`)
    }
}

/**
 * 默认 IO：转调 grpcSkill 现成装配管道（getGrpcSkillsByChannel 已含资格+哈希+剔除打回）——
 * 目录检索与工具装配读的是**同一条管道的同一份行**，两处读法必分叉（同源纪律）。
 */
async function defaultReadCatalogRows({ channel }) {
    const { getGrpcSkillsByChannel } = await import('../grpcSkill.js')
    return getGrpcSkillsByChannel(channel)
}

/** 默认审计：featureCallLog 只追加流水（log-and-forget——finishAsync 已兜抛错；
 *  审计缺席坏观测面，不坏检索——与 settle 的"留痕失败不回滚主操作"同族分工） */
async function defaultAuditSink(rec) {
    const dac = (await import('../../../daos/core/dac/featureCallLogDac.js')).default
    await dac.log({...rec, conversationCode: rec.conversationCode || '', runCode: rec.runCode || ''})
}

/**
 * 默认权限判定：ucenter `hasPriv(userCode, needPrivs[])` proto 返回**单布尔**（活码 userInfo.js:94
 * 读 response.hasPriv 标量）——语义即"对全集的 AND"，无法还原逐码结果。
 * 逐码问（每次 [p]）：检索过滤要的是逐 priv 的 granted 表，把"N 条全可见/全不可见"二态
 * 交给 AND 语义会造出错误世界（少一个 browse priv 点 ⇒ 全员全目录不可见）。
 * 成本闸（V8）：needPrivs 去重后 ≤ 数十码，run 级一次；ucenter 若后续提供批量 map，
 * 只换本函数实现，判据与调用位不动。
 */
async function defaultFetchGrants({ userCode, privs }) {
    if (!privs.length) return {}
    const { hasPriv } = await import('../../../grpc/clients/userInfo.js')
    const granted = {}
    for (const p of privs) {
        try { granted[p] = await hasPriv(userCode, [p]) === true } catch (e) {
            throw new Error(`hasPriv(${p}) 失败: ${String(e?.message || e).slice(0, 120)}`)
        }
    }
    return granted
}

export default { buildFeatureCatalogTools, isFeatureCatalogTool, executeFeatureCatalogSearch, FEATURE_SEARCH_TOOL_NAME }
