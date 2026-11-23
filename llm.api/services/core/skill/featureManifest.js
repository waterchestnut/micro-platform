/**
 * @fileOverview 子系统功能清单对账判据（platform-feature-map Phase 1 刀3，纯函数）
 * @module services/core/skill/featureManifest
 * @description
 * W8 真实缺口的判据面：manifest 的语义是"该子系统**全量**功能集"，单条 add/update 面
 * 表达不了"该删"——子系统下线一个功能，目录里留僵尸条目=AI 继续推荐不存在的东西。
 * 本件吃"库里该码行 + manifest 条目"，产出对账计划（增/改/下线/保持/陈旧待审），
 * **只判定不执行**（执行在 grpcSkill.reconcileManifest 壳，判定与 IO 分离子一贯）。
 *
 * 三条性格：
 * 1. **下线只作用于装配中行**（approved+status0）：pending/rejected 行本来就没进上下文，
 *    manifest 缺席时不"再下线一次"，而是记 stalePending——它们若被人工批准，批准的是
 *    manifest 已删的旧条目；壳把这批的 note 打上 manifest-stale，让审核面看得见（不硬拦，
 *    硬拦=对账结果反过来劫持审核决定，责任错位）。
 * 2. **匹配键=skillCode**（manifest 条目必须自带稳定键；无键条目由壳校验拒绝，不进本件）。
 * 3. **内容比较=声明字段全量**：正文之外，privs/门控/入口/效果级/调用面任何一项漂移都
 *   算变更——目录的"内容"不只是描述文案，权限与入口变了更要重审。数组先排序再比
 *   （featurePrivs/channels 的声明顺序不该造成假变更）。
 */
import { normalizeReviewStatus, SKILL_REVIEW } from './skillGovernance.js'

const normList = (v) => (Array.isArray(v) ? v : []).map((x) => String(x == null ? '' : x).trim()).filter(Boolean).sort().join('\u0001')
const normStr = (v) => String(v == null ? '' : v).trim()
const normEntryOf = (e) => [normStr(e?.subsystem), normStr(e?.menuPath), normStr(e?.url)].join('\u0002')
const normInvokeOf = (i) => [normStr(i?.api), normStr(i?.timeoutMs), normList(Object.keys((i?.paramsSchema && i?.paramsSchema.properties) || {})), normList(i?.identityParams)].join('\u0002')

/**
 * @description 单条声明面快照（比较用；返回差异字段名列表）
 * @returns {String[]} 差异字段（空数组=内容一致）
 */
export function diffManifestItem(row, item) {
    const diff = []
    if (normStr(row.skillMD) !== normStr(item.skillMD)) diff.push('skillMD')
    if (normStr(row.skillName) !== normStr(item.skillName)) diff.push('skillName')
    if (normList(row.channels) !== normList(item.channels)) diff.push('channels')
    if (normStr(row.effectClass) !== normStr(item.effectClass)) diff.push('effectClass')
    // browseGate 比较用归一值（缺失 vs false 是两种事实：缺失=没登记过，保守按 true）
    if ((row.browseGate === false ? 'f' : 't') !== (item.browseGate === false ? 'f' : 't')) diff.push('browseGate')
    if (normList(row.featurePrivs) !== normList(item.featurePrivs)) diff.push('featurePrivs')
    if (normEntryOf(row.entry) !== normEntryOf(item.entry)) diff.push('entry')
    if (normStr(row.idemKeyPolicy || 'per-run') !== normStr(item.idemKeyPolicy || 'per-run')) diff.push('idemKeyPolicy')
    if (normInvokeOf(row.invokeSpec) !== normInvokeOf(item.invokeSpec)) diff.push('invokeSpec')
    return diff
}

/**
 * @description 生成对账计划
 * @param {Object} p
 * @param {Array} [p.rows] 库里该 clientCode 的既有行（含 skillCode/声明面/status/reviewStatus）
 * @param {Array} [p.items] manifest 条目（每项必有 skillCode；结构校验在壳层先做）
 * @returns {{toAdd:Array, toUpdate:Array<{skillCode,diff}>, toOffline:Array<{skillCode,skillName}>,
 *            keep:Array<String>, stalePending:Array<String>, inManifest:Set<String>}}
 */
export function planReconcile({ rows = [], items = [] } = {}) {
    const rowList = Array.isArray(rows) ? rows.filter((r) => r && r.skillCode) : []
    const itemList = Array.isArray(items) ? items.filter((i) => i && i.skillCode) : []
    const inManifest = new Set(itemList.map((i) => String(i.skillCode)))
    const byRow = new Map(rowList.map((r) => [String(r.skillCode), r]))

    const toAdd = []
    const toUpdate = []
    const keep = []
    for (const item of itemList) {
        const row = byRow.get(String(item.skillCode))
        if (!row) { toAdd.push(item); continue }
        const diff = diffManifestItem(row, item)
        if (diff.length) toUpdate.push({ skillCode: row.skillCode, diff })
        else keep.push(row.skillCode)
    }

    const toOffline = []
    const stalePending = []
    for (const row of rowList) {
        if (inManifest.has(String(row.skillCode))) continue
        const assembling = row.status === 0 && normalizeReviewStatus(row.reviewStatus) === SKILL_REVIEW.APPROVED
        if (assembling) toOffline.push({ skillCode: row.skillCode, skillName: row.skillName || '' })
        else stalePending.push(row.skillCode)
    }

    return { toAdd, toUpdate, toOffline, keep, stalePending, inManifest }
}

/** 陈旧待审行的审核 note（壳落库时用——让批准者知道"manifest 已经不要这条了"） */
export function stalePendingNote(skillCode, stamp) {
    return `manifest-stale:${normStr(stamp) || 'no-stamp'}｜最近一次对账中该子系统清单已不含此条；批准将重新纳入装配，请确认是回捞而非误批`
}

export default { planReconcile, diffManifestItem, stalePendingNote }
