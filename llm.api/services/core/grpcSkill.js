/**
 * @fileOverview 远程gRPC技能相关的业务操作
 * @author xianyang 2026/4/1
 * @module
 */

import grpcSkillDac from '../../daos/core/dac/grpcSkillDac.js'
import skillJournalDac from '../../daos/core/dac/skillJournalDac.js'
import {remember, cacheDel} from '../../daos/cache/l2Cache.js'
import {listSkills} from '../../skill/providers/localSkillProvider.js'
import {validateChannels} from '../../conf/llmChannel.js'
import {md5} from '../../tools/security.js'
import {hasPriv} from '../../grpc/clients/userInfo.js'
import {
    SKILL_ACTIONS, SKILL_REVIEW, normalizeReviewStatus, skillEligibleForAssembly,
    checkContentHash, hostAllowed, decideSkillWrite, decideReviewTransition, governanceFieldsForWrite,
} from './skill/skillGovernance.js'
import { planReconcile, stalePendingNote } from './skill/featureManifest.js'
import {skillContentAllowed, scanSkillContent, scanSummaryForLog} from './skill/skillScan.js'
import yaml from 'js-yaml'

const tools = llm.tools
const logger = llm.logger

/**
 * 治理配置（每次读，不缓存到模块常量：应急开关要能在不发版的情况下生效）。
 * 缺配置时给"全拒绝"的形状，与 `conf/system.config.js` 里 grpcSkill 组的默认值一致。
 */
function governancePolicy() {
    const c = llm.config?.grpcSkill || {}
    return {
        adminUserCodes: Array.isArray(c.adminUserCodes) ? c.adminUserCodes : [],
        privCodes: Array.isArray(c.privCodes) ? c.privCodes : [],
        allowedHosts: Array.isArray(c.allowedHosts) ? c.allowedHosts : [],
        enforce: c.enforce !== false,
        scanEnabled: c.scanEnabled !== false,
        allowEscalationPhrasing: c.allowEscalationPhrasing === true,
        hashCheckEnabled: c.hashCheckEnabled !== false,
    }
}

/**
 * @description 留痕用的内容摘要：**绝不带正文**，只带能回答"改成了什么样"的元信息
 * @param {Object} skill 技能记录（或写入载荷）
 * @returns {Object|null} 摘要
 */
export function summarizeSkillForJournal(skill) {
    if (!skill) {
        return null
    }
    return {
        skillName: skill.skillName,
        reviewStatus: normalizeReviewStatus(skill.reviewStatus),
        skillMDHash: skill.skillMDHash || '',
        contentVersion: skill.contentVersion ?? 0,
        channels: skill.channels || [],
        grpcHost: skill.grpcHost || '',
        status: skill.status,
        /** 只留长度：正文里可能含密钥/内部接口，审计表不该多一份需要脱敏的地方 */
        skillMDChars: typeof skill.skillMD === 'string' ? skill.skillMD.length : 0,
    }
}

/**
 * @description 写一条留痕。**留痕失败不阻断主操作**，但必须 error 级可见
 * @param {Object} entry 留痕内容
 * @returns {Promise<void>} 结果
 *
 * 为什么不在这里抛：技能已经改成功了，因为审计写不进去而回滚成"操作失败"，
 * 会让运维面对一个"到底改没改"的未知状态——那比少一条审计更危险。
 * 但也不能静默：少审计意味着"口子开过多久"答不了，这正是 ⑦ 要回答的问题。
 */
async function writeJournal(entry) {
    try {
        await skillJournalDac.add(entry)
    } catch (e) {
        logger.error(`技能审计留痕失败 skillCode=${entry.skillCode || '-'} op=${entry.op || '-'}：${e.message}`)
    }
}

/**
 * @description 用 ucenter 的特权码判断是否管理员；**取不到就当不是**（fail-closed）
 * @param {String} userCode 用户标识
 * @param {String[]} privCodes 特权码清单
 * @returns {Promise<Boolean>} 结果
 *
 * 超管语义（属主判据 `privs.includes('all')` 的后端等价物）：ucenter 侧
 * hasPriv(needPrivs, assignedPrivs) 对 assignedPrivs 含 'all' **无条件返真**
 * （auth/index.js:95），所以本函数传任意 privCodes 都会给超管放行——
 * 后端不能直接读 curUserInfo.privs（网关 checkAuth 注入前清空，auth/index.js:192），
 * grpc 是唯一可信来源。
 */
export async function checkPrivAdmin(userCode, privCodes) {
    if (!userCode || !privCodes.length) {
        return false
    }
    try {
        return (await hasPriv(userCode, privCodes)) === true
    } catch (e) {
        /**
         * 出错时返回 false 是刻意的：把"ucenter 挂了"读成"有权限"，
         * 等于给治理开关装了一条"依赖服务故障时自动放行"的后门（同 contactScope 的 fail-closed）。
         * 代价写在契约里：ucenter 不可达期间没人能注册/批准技能。
         */
        logger.warn(`hasPriv 查询失败，按无权限处理 userCode=${userCode}：${e.message}`)
        return false
    }
}

/**
 * @description 写入口的权限闸门：不通过就抛带 statusCode 的错误（401/403）
 * @param {Object} curUserInfo 当前用户
 * @param {String} action SKILL_ACTIONS 之一
 * @param {Object|null} skill 目标技能（add 时为 null）
 * @param {Object} [policy] 覆盖用策略（测试注入）
 * @returns {Promise<Object>} 判定结果（供留痕 evidence 使用）
 */
export async function authorizeSkillWrite(curUserInfo, action, skill, policy = null) {
    const p = policy || governancePolicy()
    const userCode = curUserInfo?.userCode || ''
    /**
     * privGranted 是 ucenter 权限的**真值**（含 `all` 超管：ucenter hasPriv 对 assignedPrivs
     * 含 'all' 直接返真，auth/index.js:95）——照属主判据全量查，白名单用户也不跳过：
     * ① 后端 curUserInfo.privs 恒空（网关 checkAuth 注入前清空，auth/index.js:192"内容太多"），
     *    前端 authority.ts 的 `privs.includes('all')` 约定在后端**不能字面照搬**，
     *    grpc hasPriv 是它的忠实等价物——这正是"参考现有判断"在后端的正确落点；
     * ② 留痕 evidence 记 privGranted，旧版白名单短路使它恒 false——超管批准在审计账上
     *    显示成"纯白名单特权"，失真。
     * adminUserCodes 保留为 OR 兜底（ucenter 不可达时白名单 admin 仍能管闸，fail-closed 不锁死）。
     */
    let privGranted = false
    if (p.privCodes.length && userCode) {
        privGranted = await checkPrivAdmin(userCode, p.privCodes)
    }
    const d = decideSkillWrite({action, actor: curUserInfo, skill, policy: {...p, privGranted}})
    if (!d.allow) {
        const err = new Error(d.reason.startsWith('no-identity')
            ? '缺少有效的用户身份（userCode）'
            : '无权进行该远程技能操作（需要管理员或技能归属人）')
        err.statusCode = d.statusCode
        err.skillAuthReason = d.reason
        throw err
    }
    return d
}

/**
 * @description 内容闸门：注入扫描 + 主机白名单，命中即拒
 * @param {Object} payload 写入载荷
 * @param {Object} [policy] 覆盖用策略（测试注入）
 * @returns {Object} 判定明细（供留痕 evidence）
 */
export function assertContentGovernance(payload, policy = null) {
    const p = policy || governancePolicy()
    const host = hostAllowed(payload.grpcHost, {allowedHosts: p.allowedHosts})
    if (!host.allow) {
        const err = new Error(host.reason === 'host-list-unconfigured'
            ? '未配置允许的主机清单，暂不开放技能注册（grpcSkill_allowedHosts）'
            : `远程主机地址不在允许清单内或形态非法：${host.reason}`)
        err.statusCode = 403
        err.hostReason = host.reason
        throw err
    }
    if (p.scanEnabled && payload.skillMD) {
        const verdict = skillContentAllowed(payload.skillMD, {allowEscalation: p.allowEscalationPhrasing})
        if (!verdict.allow) {
            const summary = scanSummaryForLog(scanSkillContent(payload.skillMD))
            const err = new Error(`技能描述命中注入判据，已拒绝入库：${verdict.reasons.join(',')}`)
            err.statusCode = 403
            err.scanSummary = summary
            throw err
        }
    }
    return {host: host.reason, scanned: p.scanEnabled === true}
}

/**
 * @description 校验 skillMD 是否符合 SKILL.md 规范
 * @author xianyang
 * @param {String} skillMD skillMD 内容
 * @throws {Error} 校验失败时抛出错误
 */
export function validateSkillMD(skillMD) {
    if (!skillMD || typeof skillMD !== 'string') {
        throw new Error('skillMD 不能为空')
    }

    const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---/
    const match = skillMD.match(frontmatterRegex)

    if (!match) {
        throw new Error('skillMD 缺少 YAML frontmatter (--- 开头和结尾)')
    }

    let metadata
    try {
        metadata = yaml.load(match[1])
    } catch (e) {
        throw new Error(`skillMD frontmatter 格式错误: ${e.message}`)
    }

    if (!metadata || typeof metadata !== 'object') {
        throw new Error('skillMD frontmatter 解析失败')
    }

    const requiredFields = ['name', 'description', 'author', 'version', 'tags']
    for (const field of requiredFields) {
        if (!metadata[field]) {
            throw new Error(`skillMD frontmatter 缺少必需字段: ${field}`)
        }
    }

    if (typeof metadata.name !== 'string' || !metadata.name.trim()) {
        throw new Error('skillMD frontmatter 中 name 必须是字符串且不能为空')
    }

    if (typeof metadata.description !== 'string' || !metadata.description.trim()) {
        throw new Error('skillMD frontmatter 中 description 必须是字符串且不能为空')
    }

    if (typeof metadata.author !== 'string' || !metadata.author.trim()) {
        throw new Error('skillMD frontmatter 中 author 必须是字符串且不能为空')
    }

    if (typeof metadata.version !== 'string' || !metadata.version.trim()) {
        throw new Error('skillMD frontmatter 中 version 必须是字符串且不能为空')
    }

    if (!Array.isArray(metadata.tags) || metadata.tags.length === 0) {
        throw new Error('skillMD frontmatter 中 tags 必须是数组且不能为空')
    }

    const content = skillMD.slice(match[0].length).trim()
    if (!content) {
        throw new Error('skillMD 内容不能为空')
    }

    const requiredSections = ['# ', '## When to Use This Skill', '## Instructions']
    for (const section of requiredSections) {
        if (!content.includes(section)) {
            throw new Error(`skillMD 内容缺少必需章节: ${section}`)
        }
    }

    const titleMatch = content.match(/^#\s+(.+)$/m)
    if (titleMatch && titleMatch[1] !== metadata.name && titleMatch[1] !== metadata.description.split('(')[0].trim()) {
        logger.warn(`skillMD 标题 "${titleMatch[1]}" 与 name "${metadata.name}" 不匹配`)
    }
}

/**
 * @description 获取远程技能列表
 * @author xianyang
 * @param {Object} [filter] 筛选条件
 * @param {Number} [pageIndex=1] 页码
 * @param {Number} [pageSize=10] 分页大小
 * @param {Object} [options] 排序、格式化等参数
 * @param {Number} [options.total] 记录的总数（翻页时可省略总数的查询）
 * @param {{[key: string]:1 | -1}} [options.sort] 排序
 * @returns {Promise<{total: Number, rows: [Object]}>} {total: 总数, rows: 技能数组}
 */
export async function getGrpcSkills(filter = {}, pageIndex = 1, pageSize = 10, options = {}) {
    let dacOptions = {...filter}
    if (options.sort) {
        dacOptions.sort = options.sort
    } else {
        dacOptions.sort = {updateTime: -1}
    }
    if (options.total) {
        dacOptions.total = options.total
    }
    return grpcSkillDac.getByPage(pageIndex, pageSize, dacOptions)
}

/**
 * @description 获取远程技能详情
 * @author xianyang
 * @param {String} skillCode 技能标识
 * @returns {Promise<Object>} 技能详细信息
 */
export async function getGrpcSkill(skillCode) {
    return grpcSkillDac.getByCode(skillCode)
}

/**
 * @description 按频道取**可装配**的技能清单
 * @author xianyang
 * @param {String} channel 频道名称
 * @returns {Promise<Object[]>} 技能记录列表
 *
 * 两道闸，缺一不可（PR-E0.1 ②⑤）：
 * 1. `skillEligibleForAssembly` —— 只有"已批准且未禁用"的才进上下文；缺 `reviewStatus` 的老数据按 pending 处理，
 *    也就是**默认不进**（把"没登记"读成"已批准"就是本次要修的洞）；
 * 2. 内容哈希核对 —— 批准过但正文变了 ⇒ 当场剔除，并把审核态打回 pending + 留痕。
 *
 * 为什么"剔除"要顺手写库：不写的话，装配每次都剔除、日志每次都告警，
 * 而管理端看到的仍是"已批准"——**治理状态与实际生效状态分家**，正是本档一路反对的形状。
 * 写库失败不影响剔除本身（读路径绝不因审计写失败而放行）。
 *
 * ⚠️ 上线顺序：现存技能都没有 `reviewStatus`，**必须先跑存量批准迁移**
 * （`evals/platform-probes/skill-approval-migration.mjs`），否则远程工具面会在聊天里整体消失。
 */
export async function getGrpcSkillsByChannel(channel) {
    const rows = await grpcSkillDac.getTop(1000, {channels: channel, status: 0})
    const p = governancePolicy()
    const kept = []
    const degraded = []
    for (const row of rows || []) {
        if (!skillEligibleForAssembly(row)) {
            continue
        }
        if (p.hashCheckEnabled) {
            const chk = checkContentHash({skill: row, currentHash: md5(row.skillMD || '')})
            if (!chk.include) {
                degraded.push({skillCode: row.skillCode, reason: chk.reason})
                continue
            }
            if (chk.degrade) {
                /** 批准过却没存哈希（老数据/漏接线）：内容照样放行，但审核态要打回 pending 让人重新确认 */
                degraded.push({skillCode: row.skillCode, reason: chk.reason})
            }
        }
        kept.push(row)
    }
    for (const d of degraded) {
        logger.warn(`技能装配被剔除并打回待审 skillCode=${d.skillCode} reason=${d.reason}（批准针对的是那一刻的内容，D36）`)
        try {
            await grpcSkillDac.update({
                skillCode: d.skillCode,
                reviewStatus: SKILL_REVIEW.PENDING,
                reviewedBy: {$unset: true},
                reviewedAt: null,
                reviewNote: `装配期自动打回：${d.reason}`,
            })
            await writeJournal({
                skillCode: d.skillCode,
                actor: 'system',
                op: 'auto-pending',
                before: null,
                after: {reviewStatus: SKILL_REVIEW.PENDING},
                evidence: [{reason: d.reason}],
                reason: '内容哈希与批准时不一致（或缺哈希），审核态打回 pending',
            })
        } catch (e) {
            /** 降级写失败绝不放行：剔除已经发生，这里只补一条"状态没落库"的告警 */
            logger.error(`技能审核态降级写失败 skillCode=${d.skillCode}：${e.message}（本次仍按剔除处理）`)
        }
    }
    if (degraded.length) {
        await invalidateGrpcSkillCache()
    }
    return kept
}

/** LRU 命名空间，写入技能时整片清掉 */
export const GRPC_SKILL_SPACE = 'grpcSkill'

/**
 * @description 频道技能清单的缓存键
 * @author xianyang
 * @param {String} channel 频道名称
 * @returns {String} 缓存键
 */
export function grpcSkillCacheKey(channel) {
    return `skill:chan:${channel}`
}

/**
 * @description 按频道取技能清单（LRU + redis 两级）
 * 每次聊天都直查一次 Mongo 是纯浪费：技能清单只在后台改动时变，改动量以天计。
 * 注意 redis 往返会把 Date 变成 ISO 字符串，消费方只能用纯数据字段。
 * @author xianyang
 * @param {String} channel 频道名称
 * @returns {Promise<Object[]>} 技能记录列表
 */
export async function getCachedGrpcSkillsByChannel(channel) {
    const cfg = llm.config.cache || {}
    if (!cfg.skillEnabled || !channel) {
        return getGrpcSkillsByChannel(channel)
    }
    try {
        const {value, source} = await remember({
            key: grpcSkillCacheKey(channel),
            loader: () => getGrpcSkillsByChannel(channel),
            options: {ttlSeconds: cfg.skillTtlSeconds, space: GRPC_SKILL_SPACE},
        })
        if (source !== 'origin') {
            llm.logger.info(`频道 ${channel} 技能清单命中 ${source}，共 ${value?.length ?? 0} 条`)
        }
        return value || []
    } catch (e) {
        llm.logger.warn(`技能缓存读取异常，直接回源(${channel}): ${e.message}`)
        return getGrpcSkillsByChannel(channel)
    }
}

/**
 * @description 技能有增删改启停时清掉全部频道缓存
 * 改动可能同时影响多个频道（一条技能的 channels 可以是列表），
 * 逐个频道失效容易漏，写入频率极低，整片清更稳。
 * @author xianyang
 * @returns {Promise<Number>} 清掉的 redis 键数
 */
export async function invalidateGrpcSkillCache() {
    try {
        const n = await cacheDel('skill:chan:*', GRPC_SKILL_SPACE)
        llm.logger.info(`技能清单缓存已失效，清除 redis 键 ${n} 个`)
        return n
    } catch (e) {
        llm.logger.warn(`技能缓存失效操作失败: ${e.message}`)
        return 0
    }
}

/**
 * @description 添加远程技能
 * @author xianyang
 * @param {Object} curUserInfo 当前用户
 * @param {Object} grpcSkillInfo 技能信息
 * @returns {Promise<Object>} 添加成功时返回新添加的技能对象
 */
export async function addGrpcSkill(curUserInfo, grpcSkillInfo) {
    if (!grpcSkillInfo) {
        throw new Error('未传递技能数据')
    }
    /**
     * PR-E0.1 ①：**先问权限，再校验内容**。
     * 顺序不是风格问题：把内容校验放在前面，等于让任何登录用户拿一个"格式错误的注册请求"
     * 去探测我们的校验规则（错误信息不同 ⇒ 免费的规则指纹）。权限先行，未授权者连反馈格式都拿不到。
     */
    const auth = await authorizeSkillWrite(curUserInfo, SKILL_ACTIONS.ADD, null)
    if (!grpcSkillInfo.skillName) {
        throw new Error('需要技能名称')
    }
    if (!grpcSkillInfo.skillMD) {
        throw new Error('需要技能描述')
    }

    validateSkillMD(grpcSkillInfo.skillMD)

    if (!grpcSkillInfo.grpcHost) {
        throw new Error('需要远程主机地址')
    }
    if (!grpcSkillInfo.clientCode) {
        throw new Error('需要所属应用标识')
    }
    if (!grpcSkillInfo.channels || !grpcSkillInfo.channels.length) {
        throw new Error('需要指定聊天频道')
    }

    const invalidChannels = validateChannels(grpcSkillInfo.channels)
    if (invalidChannels.length > 0) {
        throw new Error(`无效的频道: ${invalidChannels.join(', ')}，这些频道未在配置中定义`)
    }

    /** PR-E0.1 ③④：主机白名单 + 注入扫描（命中即拒，不落库） */
    const content = assertContentGovernance(grpcSkillInfo)

    const skillNameRegex = /^[a-z][a-z0-9-]*$/
    if (!skillNameRegex.test(grpcSkillInfo.skillName)) {
        throw new Error('技能名称格式不正确，只能包含小写英文字母、数字、短横线，且首字符必须是英文字母')
    }

    const existingGrpcSkill = await grpcSkillDac.getOneByFilter({skillName: grpcSkillInfo.skillName, status: {$ne: -1}})
    if (existingGrpcSkill) {
        throw new Error('技能名称已存在')
    }

    const localSkills = await listSkills()
    const localSkillNames = localSkills.map(s => s.name)
    if (localSkillNames.includes(grpcSkillInfo.skillName)) {
        throw new Error('技能名称已存在')
    }

    grpcSkillInfo.skillCode = grpcSkillInfo.skillCode || tools.getUUID()

    let oldGrpcSkill = await grpcSkillDac.getByCode(grpcSkillInfo.skillCode)
    if (oldGrpcSkill) {
        throw new Error('技能标识已存在')
    }

    /**
     * PR-E0.1 ②⑤：新注册的技能默认 **pending**，并当场记下内容哈希。
     * 这两件事合起来才让"注册"与"生效"分开：注册只是提交候选，进谁的上下文由批准决定。
     */
    const gov = governanceFieldsForWrite({
        skill: null,
        newSkillMD: grpcSkillInfo.skillMD,
        newHash: md5(grpcSkillInfo.skillMD),
        actor: curUserInfo,
    })
    let newGrpcSkill = {
        skillCode: grpcSkillInfo.skillCode,
        skillName: grpcSkillInfo.skillName,
        skillMD: grpcSkillInfo.skillMD,
        grpcHost: grpcSkillInfo.grpcHost,
        clientCode: grpcSkillInfo.clientCode,
        channels: grpcSkillInfo.channels,
        note: grpcSkillInfo.note,
        operator: {userCode: curUserInfo.userCode, realName: curUserInfo.realName},
        status: 0,
        tags: grpcSkillInfo.tags,
        reviewStatus: gov.reviewStatus,
        skillMDHash: gov.skillMDHash,
        contentVersion: 1,
        reviewedBy: null,
        reviewedAt: null,
    }
    let ret = await grpcSkillDac.add(newGrpcSkill)
    await invalidateGrpcSkillCache()
    await writeJournal({
        skillCode: newGrpcSkill.skillCode,
        skillName: newGrpcSkill.skillName,
        actor: 'user',
        op: 'add',
        actorUser: {userCode: curUserInfo.userCode, realName: curUserInfo.realName},
        before: null,
        after: summarizeSkillForJournal(newGrpcSkill),
        evidence: [{authReason: auth.reason, hostReason: content.host, scanned: content.scanned}],
        reason: '注册技能（默认待审核）',
    })
    return ret
}

/**
 * @description 修改远程技能
 * @author xianyang
 * @param {Object} curUserInfo 当前用户
 * @param {String} skillCode 技能标识
 * @param {Object} newGrpcSkillInfo 新的技能对象
 * @returns {Promise<Object>} 受影响的行数
 */
export async function updateGrpcSkill(curUserInfo, skillCode, newGrpcSkillInfo) {
    if (!skillCode) {
        throw new Error('缺少技能标识')
    }
    if (!newGrpcSkillInfo) {
        throw new Error('没有要更新的数据')
    }

    const currentSkill = await grpcSkillDac.getByCode(skillCode)
    /** 先权限后查库（同 reviewGrpcSkill）：技能不存在时按"非归属人"判，陌生人拿不到存在性反馈 */
    const auth = await authorizeSkillWrite(curUserInfo, SKILL_ACTIONS.UPDATE, currentSkill)
    if (!currentSkill) {
        const err = new Error('要更新的技能不存在')
        err.statusCode = 404
        throw err
    }

    if (newGrpcSkillInfo.skillName && currentSkill.skillName !== newGrpcSkillInfo.skillName) {
        const skillNameRegex = /^[a-z][a-z0-9-]*$/
        if (!skillNameRegex.test(newGrpcSkillInfo.skillName)) {
            throw new Error('技能名称格式不正确，只能包含小写英文字母、数字、短横线，且首字符必须是英文字母')
        }

        const existingGrpcSkill = await grpcSkillDac.getOneByFilter({
            skillName: newGrpcSkillInfo.skillName,
            status: {$ne: -1}
        })
        if (existingGrpcSkill) {
            throw new Error('技能名称已存在')
        }

        const localSkills = await listSkills()
        const localSkillNames = localSkills.map(s => s.name)
        if (localSkillNames.includes(newGrpcSkillInfo.skillName)) {
            throw new Error('技能名称已存在')
        }
    }

    if (newGrpcSkillInfo.skillMD) {
        validateSkillMD(newGrpcSkillInfo.skillMD)
    }

    if (newGrpcSkillInfo.channels) {
        const invalidChannels = validateChannels(newGrpcSkillInfo.channels)
        if (invalidChannels.length > 0) {
            throw new Error(`无效的频道: ${invalidChannels.join(', ')}，这些频道未在配置中定义`)
        }
    }

    /**
     * PR-E0.1 ③④⑤：正文变了就重新扫描 + 重算哈希 + 打回 pending。
     * 这里最容易犯的错是"只更新内容不更新审核"——那等于批准一次永久有效（D36 说的 rug pull）。
     * 主机没申报时沿用现值再校验一遍：否则"改别字段"能绕过白名单把 host 留在非法值上。
     */
    const merged = {
        grpcHost: newGrpcSkillInfo.grpcHost || currentSkill.grpcHost,
        skillMD: newGrpcSkillInfo.skillMD || currentSkill.skillMD,
    }
    const content = assertContentGovernance(merged)
    const mdChanged = Boolean(newGrpcSkillInfo.skillMD) && newGrpcSkillInfo.skillMD !== currentSkill.skillMD
    const gov = governanceFieldsForWrite({
        skill: currentSkill,
        newSkillMD: merged.skillMD,
        newHash: md5(merged.skillMD),
        actor: curUserInfo,
    })

    let grpcSkillInfo = {
        skillCode,
        skillName: newGrpcSkillInfo.skillName,
        skillMD: newGrpcSkillInfo.skillMD,
        grpcHost: newGrpcSkillInfo.grpcHost,
        channels: newGrpcSkillInfo.channels,
        note: newGrpcSkillInfo.note,
        tags: newGrpcSkillInfo.tags,
        reviewStatus: gov.reviewStatus,
        skillMDHash: gov.skillMDHash,
        contentVersion: (currentSkill.contentVersion || 1) + (mdChanged ? 1 : 0),
        ...(mdChanged ? {reviewedBy: {$unset: true}, reviewedAt: null, reviewNote: ''} : {}),
    }

    let ret = await grpcSkillDac.update(grpcSkillInfo)
    await invalidateGrpcSkillCache()
    await writeJournal({
        skillCode,
        skillName: newGrpcSkillInfo.skillName || currentSkill.skillName,
        actor: 'user',
        op: 'update',
        actorUser: {userCode: curUserInfo.userCode, realName: curUserInfo.realName},
        before: summarizeSkillForJournal(currentSkill),
        after: summarizeSkillForJournal({...currentSkill, ...grpcSkillInfo}),
        evidence: [{
            authReason: auth.reason, hostReason: content.host, scanned: content.scanned,
            mdChanged, reviewReset: gov.reviewReset,
        }],
        reason: mdChanged ? '正文变更：审核态已打回 pending' : '元信息变更（正文未变）',
    })
    return ret
}

/**
 * @description 删除远程技能
 * @author xianyang
 * @param {Object} curUserInfo 当前用户
 * @param {String} skillCode 技能标识
 * @returns {Promise<Object>} 受影响的行数
 */
export async function deleteGrpcSkill(curUserInfo, skillCode) {
    if (!skillCode) {
        throw new Error('缺少技能标识')
    }

    const currentSkill = await grpcSkillDac.getByCode(skillCode)
    const auth = await authorizeSkillWrite(curUserInfo, SKILL_ACTIONS.DELETE, currentSkill)
    if (!currentSkill) {
        const err = new Error('要删除的技能不存在')
        err.statusCode = 404
        throw err
    }

    const ret = await grpcSkillDac.update({skillCode, status: -1})
    await invalidateGrpcSkillCache()
    await writeJournal({
        skillCode,
        skillName: currentSkill.skillName,
        actor: 'user',
        op: 'delete',
        actorUser: {userCode: curUserInfo.userCode, realName: curUserInfo.realName},
        before: summarizeSkillForJournal(currentSkill),
        after: {status: -1},
        evidence: [{authReason: auth.reason}],
        reason: '软删除技能',
    })
    return ret
}

/**
 * @description 启用远程技能
 * @author xianyang
 * @param {Object} curUserInfo 当前用户
 * @param {String} skillCode 技能标识
 * @returns {Promise<Object>} 受影响的行数
 *
 * **未批准的技能不允许启用**——这一条是本次接线里最容易被漏掉的后门：
 * 如果 enable 不看审核态，"注册(pending) → 启用"就能绕过批准，治理做成了走形式。
 * 判据复用装配侧的 `skillEligibleForAssembly`，两处共用一个定义而不是各写一遍。
 */
/**
 * 功能清单对账（platform-feature-map 刀3，W8 缺口收口）。
 * manifest=子系统该 clientCode 的**全量**功能集声明；对账语义=增（新增条目→pending）、
 * 改（声明面任何字段漂移→pending+新哈希）、**下线**（库里在装配而 manifest 已缺席→打回 pending
 * reason=manifest-removed——僵尸条目是"AI 继续推荐不存在功能"的直接成因）。
 *
 * 三条纪律：
 * 1. **原子预检**：items 全部结构校验（skillCode 必备/skillName 词法/skillMD frontmatter/
 *    注入扫描/host 白名单）任一失败 ⇒ 整案拒、零写库——manifest 半入库比不入库更糟
 *    （半套目录=推荐面与真实能力对不上，且对账方无从知道自己哪半进去了）。
 * 2. **收缩序执行**：下线→改→新增。中途崩 ⇒ 库里剩"更小不是更大"的装配面
 *    （少进可补对账，残留即僵尸——方向性选择，不是风格）。
 * 3. **注册落库同款**：新行 skillCode 保留 manifest 稳定键（对账匹配键的地基）、默认 pending+
 *    哈希、journal 逐行（op=add/update，detail 带 reconcile 与 stamp——词表不扩，evidence 说真话）。
 * 权限：SKILL_ACTIONS.RECONCILE 不在 OWNER_ALLOWED（批量下线权不给归属人），admin 专属。
 * @param {Object} curUserInfo 当前用户（须 admin）
 * @param {Object} payload {clientCode, grpcHost, stamp?, items:[{skillCode, skillName, skillMD,
 *        channels, effectClass?, browseGate?, featurePrivs?, entry?, invokeSpec?, idemKeyPolicy?}]}
 * @returns {Promise<Object>} {reconciled:{added,updated,offlined,kept,stalePending}, stamp}
 */
export async function reconcileManifest(curUserInfo, payload = {}) {
    const clientCode = String(payload.clientCode || '').trim()
    const items = Array.isArray(payload.items) ? payload.items : []
    const stamp = String(payload.stamp || '').trim()
    const grpcHost = String(payload.grpcHost || '').trim()
    if (!clientCode || !grpcHost || !Array.isArray(payload.items)) throw new Error('对账需要 clientCode/grpcHost/items（在场性检查，语义判定在权限之后）')

    // 权限先行（add 判例同款）：未授权者连"空 manifest 会被怎么对待"这种语义反馈都拿不到
    const auth = await authorizeSkillWrite(curUserInfo, SKILL_ACTIONS.RECONCILE, null)

    if (!items.length) throw new Error('manifest 为空——空清单对账=整码下线，请走逐条 disable/显式空声明接口，本面对话不猜"空数组是不是故意的"')

    // —— 原子预检（零写库）——
    const skillNameRegex = /^[a-z][a-z0-9-]*$/
    const seen = new Set()
    for (const [idx, it] of items.entries()) {
        const tag = `条目[${idx}(${it && it.skillCode ? String(it.skillCode) : '?'})]`
        if (!it || typeof it !== 'object') throw new Error(`${tag}: 非对象`)
        if (!String(it.skillCode || '').trim()) throw new Error(`${tag}: 缺 skillCode（对账匹配键，无键条目不收）`)
        if (seen.has(String(it.skillCode))) throw new Error(`${tag}: manifest 内 skillCode 重复`)
        seen.add(String(it.skillCode))
        if (!it.skillName || !skillNameRegex.test(String(it.skillName))) throw new Error(`${tag}: skillName 词法不合法`)
        if (!it.skillMD) throw new Error(`${tag}: 缺 skillMD`)
        validateSkillMD(it.skillMD)
        if (!Array.isArray(it.channels) || !it.channels.length) throw new Error(`${tag}: 缺 channels`)
        const badCh = validateChannels(it.channels)
        if (badCh.length) throw new Error(`${tag}: 无效频道 ${badCh.join(',')}`)
        const content = assertContentGovernance({ ...it, grpcHost })   // host 白名单+注入扫描，同注册面判据
        if (content.scanHit) throw new Error(`${tag}: 正文命中注入判据 ${JSON.stringify(content.scanSummary || {})}`)
    }

    const rows = (await grpcSkillDac.getTop(1000, { clientCode, status: 0 })) || []  // 形照 getGrpcSkillsByChannel 先例（$ne 算子形被 dac cast 拒——母本探针真链逼出，同款修复同步）
    const plan = planReconcile({ rows, items })
    const byCode = new Map(rows.map((r) => [String(r.skillCode), r]))
    const now = new Date()

    const touched = []

    let offlined = 0
    for (const o of plan.toOffline) {
        const row = byCode.get(String(o.skillCode))
        await grpcSkillDac.update({
            reviewStatus: SKILL_REVIEW.PENDING,
            /** $unset 形（母本 2026-11-23 实锤同步）：标量 null 会被 notNeedUpdate 静默跳过，"清除"从未生效 */
            reviewedBy: {$unset: true}, reviewedAt: null,
            reviewNote: `manifest-removed:${stamp || 'no-stamp'}｜最近对账中该子系统清单已不含此条，装配已撤，复核后可再批`,
        }, { skillCode: o.skillCode })
        await writeJournal({
            skillCode: o.skillCode, skillName: o.skillName, actor: 'user', op: 'update',
            actorUser: { userCode: curUserInfo.userCode, realName: curUserInfo.realName },
            before: summarizeSkillForJournal(row),
            after: summarizeSkillForJournal({ ...(row || {}), reviewStatus: SKILL_REVIEW.PENDING }),
            evidence: [{ authReason: auth.reason, reconcile: 'offline', stamp }],
            reason: '清单对账下线（manifest 缺席）',
        })
        touched.push(o.skillCode)
        offlined++
    }

    let updated = 0
    for (const u of plan.toUpdate) {
        const row = byCode.get(String(u.skillCode))
        const item = items.find((x) => String(x.skillCode) === String(u.skillCode))
        const gov = governanceFieldsForWrite({
            skill: row, newSkillMD: item.skillMD, newHash: md5(item.skillMD), actor: curUserInfo,
        })
        await grpcSkillDac.update({
            skillName: item.skillName, skillMD: item.skillMD, channels: item.channels, grpcHost,
            effectClass: item.effectClass || 'guide',
            browseGate: item.browseGate === false ? false : (item.browseGate === true ? true : row.browseGate),
            featurePrivs: Array.isArray(item.featurePrivs) ? item.featurePrivs : [],
            ...(item.entry ? { entry: item.entry } : {}),
            ...(item.invokeSpec ? { invokeSpec: item.invokeSpec } : {}),
            ...(item.idemKeyPolicy ? { idemKeyPolicy: item.idemKeyPolicy } : {}),
            sourceManifest: { subsystemCode: clientCode, version: stamp, stamp },
            ...gov,
        }, { skillCode: u.skillCode })
        await writeJournal({
            skillCode: u.skillCode, skillName: item.skillName, actor: 'user', op: 'update',
            actorUser: { userCode: curUserInfo.userCode, realName: curUserInfo.realName },
            before: summarizeSkillForJournal(row),
            after: summarizeSkillForJournal({ ...row, ...item, ...gov }),
            evidence: [{ authReason: auth.reason, reconcile: 'update', diff: u.diff, stamp }],
            reason: `清单对账变更（${u.diff.join(',')}）——回待审`,
        })
        touched.push(u.skillCode)
        updated++
    }

    let added = 0
    for (const item of plan.toAdd) {
        // 撞码防御（母本同款）：rows 只含 status:0 面，manifest 复用历史禁用/软删码时
        // add 会插第二同码行（skillCode 索引非唯一）——整案中止优于脏行
        const ghost = await grpcSkillDac.getByCode(String(item.skillCode))
        if (ghost) throw new Error(`新增条目 ${item.skillCode} 与库内非活跃历史行撞码——manifest 复用历史码，整案中止请改码后重对账`)
        const dupName = await grpcSkillDac.getOneByFilter({ skillName: item.skillName, status: { $ne: -1 } })
        if (dupName) throw new Error(`新增条目 ${item.skillCode} 的 skillName 与库内他条冲突——整案中止（收缩序下已执行的 offline/update 保持事实，journal 可数）`)
        const gov = governanceFieldsForWrite({
            skill: null, newSkillMD: item.skillMD, newHash: md5(item.skillMD), actor: curUserInfo,
        })
        await grpcSkillDac.add({
            skillCode: String(item.skillCode),
            skillName: item.skillName, skillMD: item.skillMD, grpcHost, clientCode,
            channels: item.channels,
            effectClass: item.effectClass || 'guide',
            browseGate: item.browseGate === undefined ? undefined : item.browseGate === true,
            featurePrivs: Array.isArray(item.featurePrivs) ? item.featurePrivs : [],
            ...(item.entry ? { entry: item.entry } : {}),
            ...(item.invokeSpec ? { invokeSpec: item.invokeSpec } : {}),
            ...(item.idemKeyPolicy ? { idemKeyPolicy: item.idemKeyPolicy } : {}),
            sourceManifest: { subsystemCode: clientCode, version: stamp, stamp },
            operator: { userCode: curUserInfo.userCode, realName: curUserInfo.realName },
            status: 0,
            ...gov,
            reviewedBy: {$unset: true}, reviewedAt: null,
        })
        await writeJournal({
            skillCode: String(item.skillCode), skillName: item.skillName, actor: 'user', op: 'add',
            actorUser: { userCode: curUserInfo.userCode, realName: curUserInfo.realName },
            before: null,
            after: summarizeSkillForJournal({ ...item, reviewStatus: gov.reviewStatus, skillMDHash: gov.skillMDHash, contentVersion: 1, channels: item.channels, grpcHost, status: 0 }),
            evidence: [{ authReason: auth.reason, reconcile: 'add', stamp }],
            reason: '清单对账新增（默认待审核）',
        })
        touched.push(String(item.skillCode))
        added++
    }

    // 陈旧 pending 行（manifest 缺席且本来就没在装配）：不劫持审核，只把事实挂进 note
    let stalePending = 0
    for (const sc of plan.stalePending) {
        const row = byCode.get(String(sc))
        await grpcSkillDac.update({ reviewNote: stalePendingNote(sc, stamp) }, { skillCode: sc })
        stalePending++
        void row
    }

    if (touched.length) await invalidateGrpcSkillCache()
    logger.info(`功能清单对账 clientCode=${clientCode} stamp=${stamp || '-'} 下线=${offlined} 变更=${updated} 新增=${added} 保持=${plan.keep.length} 陈旧待审=${stalePending}`)
    return {
        reconciled: {
            offlined, updated, added, kept: plan.keep.length, stalePending,
        },
        stamp, clientCode, at: now.toISOString(),
    }
}

export async function enableGrpcSkill(curUserInfo, skillCode) {
    if (!skillCode) {
        throw new Error('缺少技能标识')
    }

    const currentSkill = await grpcSkillDac.getByCode(skillCode)
    const auth = await authorizeSkillWrite(curUserInfo, SKILL_ACTIONS.ENABLE, currentSkill)
    if (!currentSkill) {
        const err = new Error('要启用的技能不存在')
        err.statusCode = 404
        throw err
    }
    if (!skillEligibleForAssembly(currentSkill)) {
        const err = new Error(`技能尚未通过审核（当前 ${normalizeReviewStatus(currentSkill.reviewStatus)}），不能启用`)
        err.statusCode = 403
        throw err
    }

    const ret = await grpcSkillDac.update({skillCode, status: 0})
    await invalidateGrpcSkillCache()
    await writeJournal({
        skillCode,
        skillName: currentSkill.skillName,
        actor: 'user',
        op: 'enable',
        actorUser: {userCode: curUserInfo.userCode, realName: curUserInfo.realName},
        before: summarizeSkillForJournal(currentSkill),
        after: {status: 0, reviewStatus: normalizeReviewStatus(currentSkill.reviewStatus)},
        evidence: [{authReason: auth.reason}],
        reason: '启用技能（审核态已批准）',
    })
    return ret
}

/**
 * @description 禁用远程技能
 * @author xianyang
 * @param {Object} curUserInfo 当前用户
 * @param {String} skillCode 技能标识
 * @returns {Promise<Object>} 受影响的行数
 */
export async function disableGrpcSkill(curUserInfo, skillCode) {
    if (!skillCode) {
        throw new Error('缺少技能标识')
    }

    const currentSkill = await grpcSkillDac.getByCode(skillCode)
    const auth = await authorizeSkillWrite(curUserInfo, SKILL_ACTIONS.DISABLE, currentSkill)
    if (!currentSkill) {
        const err = new Error('要禁用的技能不存在')
        err.statusCode = 404
        throw err
    }

    const ret = await grpcSkillDac.update({skillCode, status: 1})
    await invalidateGrpcSkillCache()
    await writeJournal({
        skillCode,
        skillName: currentSkill.skillName,
        actor: 'user',
        op: 'disable',
        actorUser: {userCode: curUserInfo.userCode, realName: curUserInfo.realName},
        before: summarizeSkillForJournal(currentSkill),
        after: {status: 1},
        evidence: [{authReason: auth.reason}],
        reason: '禁用技能',
    })
    return ret
}

/**
 * @description 审核动作（批准 / 驳回 / 撤销）——PR-E0.1 ② 的"批准"这一步
 * @author 2026-11-13
 * @param {Object} curUserInfo 当前用户
 * @param {String} skillCode 技能标识
 * @param {Object} params 参数
 * @param {String} params.to 目标态：approved / rejected / revoked
 * @param {String} [params.reason] 理由（驳回与撤销必填）
 * @returns {Promise<Object>} 结果摘要
 *
 * 三条设计纪律：
 * 1. **作者不能自批**（判据在 `decideReviewTransition`）：能自批的归属校验等于没有归属校验；
 * 2. **批准时把当前内容哈希钉下来**：不钉哈希，批准就只是"批准过这个名字的东西"，
 *    而装配用的是正文（D36 的 rug pull 正是从这里进来的）；
 * 3. **驳回/撤销必须给理由**：留痕的价值在"为什么"，一句"驳回"半年后没人能复原判断。
 */
export async function reviewGrpcSkill(curUserInfo, skillCode, {to = '', reason = ''} = {}) {
    if (!skillCode) {
        const err = new Error('缺少技能标识')
        err.statusCode = 400
        throw err
    }
    /**
     * **先权限、后查库**。上一版反过来写，于是任何登录用户都能拿一个 skillCode 试探：
     * 命中就走到"技能不存在/存在"，没命中就 403 —— 状态码差本身就是一台存在性预言机，
     * 而这次改动要收的正是"陌生人能探测注册面"这类反馈（同 `autohooks.js` 那条防枚举口径）。
     * 审核的判定只需要"这个人是不是管理员"，不需要技能记录，所以这里天然可以前置。
     */
    const p = governancePolicy()
    let privGranted = false
    if (p.privCodes.length && curUserInfo?.userCode) {   // 同 authorizeSkillWrite：priv 真值全量查（all 超管经 hasPriv 尊重），白名单只做 OR 兜底
        privGranted = await checkPrivAdmin(curUserInfo.userCode, p.privCodes)
    }
    const d = decideReviewTransition({to, actor: curUserInfo, policy: {...p, privGranted}})
    if (!d.allow) {
        const err = new Error(d.reason === 'admin-only'
            ? '只有管理员可以审核远程技能（作者不能自批）'
            : `审核目标态不合法：${String(to || '(空)')}`)
        err.statusCode = d.statusCode
        throw err
    }
    if (to !== SKILL_REVIEW.APPROVED && !String(reason || '').trim()) {
        const err = new Error('驳回或撤销必须填写理由（留痕要回答"为什么"）')
        err.statusCode = 400
        throw err
    }
    const currentSkill = await grpcSkillDac.getByCode(skillCode)
    if (!currentSkill) {
        const err = new Error('要审核的技能不存在')
        err.statusCode = 404
        throw err
    }

    const opMap = {[SKILL_REVIEW.APPROVED]: 'approve', [SKILL_REVIEW.REJECTED]: 'reject', [SKILL_REVIEW.REVOKED]: 'revoke'}
    /** 批准时钉住**当前正文**的哈希；撤销/驳回不动哈希（内容没变，变的是结论） */
    const patch = {
        skillCode,
        reviewStatus: to,
        reviewedBy: {userCode: curUserInfo.userCode, realName: curUserInfo.realName},
        reviewedAt: new Date(),
        reviewNote: String(reason || '').slice(0, 500),
        ...(to === SKILL_REVIEW.APPROVED ? {skillMDHash: md5(currentSkill.skillMD || '')} : {}),
    }
    const ret = await grpcSkillDac.update(patch)
    await invalidateGrpcSkillCache()
    await writeJournal({
        skillCode,
        skillName: currentSkill.skillName,
        actor: 'user',
        op: opMap[to],
        actorUser: {userCode: curUserInfo.userCode, realName: curUserInfo.realName},
        before: summarizeSkillForJournal(currentSkill),
        after: summarizeSkillForJournal({...currentSkill, ...patch}),
        evidence: [{privGranted, fromReviewStatus: normalizeReviewStatus(currentSkill.reviewStatus)}],
        reason: String(reason || '').slice(0, 500) || '批准（无需理由）',
    })
    return {skillCode, reviewStatus: to, changed: ret}
}