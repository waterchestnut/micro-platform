/**
 * @fileOverview u2u 建会话/发消息的关系校验（取数 + 判定 + fail-closed）
 * @module services/core/mentorContact
 * @description
 * PR-R0 的取数侧：把 ucenter 的导师体系（`getMentorStudents` / `getMentorTeachers`）接进来，
 * 交给纯函数 `contactScope.decideContact` 做判定。
 *
 * 两条必须写清楚的降级规则：
 * 1. **gRPC 失败 ⇒ 拒绝**（D54/D61）。关系服务抖动时放行，等于把"任何人可与任意 userCode 建会话"
 *    这个刚堵上的口子从另一侧重新打开；宁可让用户稍后再试。
 * 2. **结果按用户短 TTL 缓存**：这条判定会挂在每次发消息上，而师生关系是低频变化的数据；
 *    不缓存的话 ucenter 会被自己的下游打穿。缓存只在"允许"时保留，拒绝结果不缓存——
 *    避免一次抖动或一次配错被钉住 60 秒。
 */

import {getMentorStudents, getMentorTeachers} from '../../grpc/clients/userInfo.js'
import {decideContact, assertContact} from './contactScope.js'

const logger = llm.logger

/** 关系列表的进程内缓存：key 是查询主体工号 */
const CACHE_TTL_MS = Number(process.env.U2U_CONTACT_CACHE_TTL_MS || 60000)
const CACHE_MAX = Number(process.env.U2U_CONTACT_CACHE_MAX || 5000)
const cache = new Map()

/**
 * @description 读缓存，过期即删
 * @param {String} key 缓存键
 * @returns {Object|null} 命中的缓存值
 */
function cacheGet(key) {
    const hit = cache.get(key)
    if (!hit) {
        return null
    }
    if (Date.now() - hit.at > CACHE_TTL_MS) {
        cache.delete(key)
        return null
    }
    return hit.value
}

/**
 * @description 写缓存（只存允许结果，并做简单容量控制）
 * @param {String} key 缓存键
 * @param {Object} value 缓存值
 * @returns {void}
 */
function cacheSet(key, value) {
    if (cache.size >= CACHE_MAX) {
        /** 淘汰最早写入的一条：Map 保持插入序，不需要额外的 LKU 结构 */
        const oldest = cache.keys().next()
        if (!oldest.done) {
            cache.delete(oldest.value)
        }
    }
    cache.set(key, {at: Date.now(), value})
}

/**
 * @description 取当前用户可联系的工号集合（学生 + 导师）
 * @param {String} currentUserCode 当前登录用户工号
 * @returns {Promise<{ok: Boolean, myStudentCodes: String[], myTeacherCodes: String[], error: String}>}
 *          ok=false 表示 ucenter 不可达或出错，调用方必须 fail-closed
 */
export async function loadContactCodes(currentUserCode) {
    const empty = {ok: false, myStudentCodes: [], myTeacherCodes: [], error: ''}
    if (!currentUserCode) {
        return {...empty, error: 'no-user'}
    }

    const cached = cacheGet(`contact:${currentUserCode}`)
    if (cached) {
        return cached
    }

    /** 两个方向并行取：串行会把 ucenter 的一次抖动放大成两倍的等待 */
    const [stuRet, teaRet] = await Promise.allSettled([
        getMentorStudents(currentUserCode),
        getMentorTeachers(currentUserCode),
    ])
    const stuErr = stuRet.status === 'rejected' ? stuRet.reason : null
    const teaErr = teaRet.status === 'rejected' ? teaRet.reason : null
    if (stuErr || teaErr) {
        const error = String(stuErr?.message || teaErr?.message || stuErr || teaErr).slice(0, 200)
        logger.warn(`导师关系查询失败，按 fail-closed 拒绝: userCode=${currentUserCode}, err=${error}`)
        /** 拒绝结果不进缓存：一次抖动不该被钉住一分钟 */
        return {ok: false, myStudentCodes: [], myTeacherCodes: [], error}
    }

    const value = {
        ok: true,
        myStudentCodes: stuRet.value || [],
        myTeacherCodes: teaRet.value || [],
        error: '',
    }
    cacheSet(`contact:${currentUserCode}`, value)
    return value
}

/**
 * @description 判定并断言"当前用户能否与目标用户建/用 u2u 会话"，不允许则抛 4xx
 * @param {String} currentUserCode 当前登录用户工号
 * @param {String} targetUserCode 目标用户工号
 * @param {Object} [opts] 透传给判定的选项
 * @param {Boolean} [opts.allowSelf] 是否允许自己与自己（u2u 默认不允许）
 * @returns {Promise<{allowed: Boolean, reason: String}>} 判定结果（断言失败时抛错）
 */
export async function assertCanContact(currentUserCode, targetUserCode, {allowSelf = false} = {}) {
    /**
     * 应急开关（默认开）。关掉等于把 PR-E0.7 写侧的口子重新打开，
     * 所以这里只允许"发布顺序"级别的用途，并且每次调用都留下 warn 痕迹，便于事后审计谁在什么时候放行了。
     */
    if (llm.config?.ucenterConfig?.contactCheckEnabled === false) {
        logger.warn(`u2u 关系校验已被配置关闭（contactCheckEnabled=false）: ${currentUserCode} -> ${targetUserCode}`)
        return {allowed: true, reason: 'disabled'}
    }

    const loaded = await loadContactCodes(currentUserCode)
    const decision = decideContact({
        currentUserCode,
        targetUserCode,
        myStudentCodes: loaded.myStudentCodes,
        myTeacherCodes: loaded.myTeacherCodes,
        upstreamOk: loaded.ok,
        allowSelf,
    })
    assertContact(decision)
    return decision
}

/**
 * @description 清掉关系缓存（配置变更、灰度切换、测试用）
 * @param {String} [userCode] 只清某个用户；不传则清空
 * @returns {Number} 清理后的条目数
 */
export function clearContactCache(userCode) {
    if (userCode) {
        cache.delete(`contact:${userCode}`)
    } else {
        cache.clear()
    }
    return cache.size
}
