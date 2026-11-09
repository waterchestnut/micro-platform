/**
 * @fileOverview u2u 会话的成员资格判定（纯函数）
 * @module services/core/contactScope
 * @description
 * PR-R0 的判定内核，PR-E0.7 写侧的依赖。之所以单独成模块：
 * - `services/core/messageScope.js` 已经验证过这个形状好用——**判定是纯函数，取数是副作用**，
 *   纯的部分可以离线穷举，副作用的部分失败时才有明确的降级路径；
 * - 这条判定决定"谁能和谁建会话"，它的规则必须能被测试穷举，而不是埋在调用链里。
 *
 * 口径（D53/D55）：**双向可联系集合包含**。成员恒为两个真人（师与生 1:1），AI 是通道不是成员。
 * 数据源是 ucenter 的导师体系（`mentorScope` + `studentMentorBinding`），**不另造第二套关系口径**（D52）。
 *
 * fail-closed（D54/D61）：没有身份、没有目标、上游查询失败，一律**拒绝**；
 * 绝不因为"拿不到关系数据"退化成"谁都能建会话"——那等于把 PR-E0.7 堵住的口子从另一侧重新打开。
 */

/* 判定内核零依赖：只用标准库，保证可离线穷举（与 messageScope.js 同口径） */

/**
 * @description 工号是否是一个可用身份：**必须是非空字符串**
 *
 * 这里比 `tools.isExist` 更严：`isExist(0)` 为真，而 `0` 不是任何人的工号。
 * 判定内核接受非字符串身份，等于给"传个 0 也能算有身份"留了口子。
 * 只做**有效性**校验、不做归一化（不 trim、不变大小写）：工号是 ucenter 主键，
 * 匹配时用错形态比用不了更危险。
 * @param {*} value 待判定的工号
 * @returns {Boolean} true 表示可以作为身份参与判定
 */
function isUserCode(value) {
    return typeof value === 'string' && value.trim() !== ''
}

/**
 * @description 判定当前用户是否可以与目标用户建立/使用 u2u 会话
 * @param {Object} state 判定现场
 * @param {String} [state.currentUserCode] 当前登录用户工号（服务端注入，不可来自请求体）
 * @param {String} [state.targetUserCode] 目标用户工号
 * @param {String[]} [state.myStudentCodes] 我的学生工号列表（ucenter 导师体系）
 * @param {String[]} [state.myTeacherCodes] 我的导师工号列表（ucenter 导师体系）
 * @param {Boolean} [state.upstreamOk] 关系数据是否取到了；false 表示 gRPC 失败，必须拒绝
 * @param {Boolean} [state.allowSelf] 是否允许自己和自己（u2u 默认不允许，`sendU2uMessage` 里本就有这条）
 * @returns {{allowed: Boolean, reason: String}} reason 是稳定枚举，日志与前端文案都按它分派
 */
export function decideContact({
    currentUserCode,
    targetUserCode,
    myStudentCodes = [],
    myTeacherCodes = [],
    upstreamOk = true,
    allowSelf = false,
} = {}) {
    if (!isUserCode(currentUserCode)) {
        return {allowed: false, reason: 'no-user'}
    }
    if (!isUserCode(targetUserCode)) {
        return {allowed: false, reason: 'no-target'}
    }
    if (!upstreamOk) {
        /** 关系数据取不到时拒绝：这是 fail-closed 的核心，不能因为 ucenter 抖动就放行 */
        return {allowed: false, reason: 'upstream-error'}
    }
    if (currentUserCode === targetUserCode) {
        return allowSelf
            ? {allowed: true, reason: 'self'}
            : {allowed: false, reason: 'self-not-allowed'}
    }

    const students = new Set((myStudentCodes || []).filter(Boolean))
    const teachers = new Set((myTeacherCodes || []).filter(Boolean))
    if (students.has(targetUserCode)) {
        return {allowed: true, reason: 'is-my-student'}
    }
    if (teachers.has(targetUserCode)) {
        return {allowed: true, reason: 'is-my-teacher'}
    }
    return {allowed: false, reason: 'no-relation'}
}

/**
 * @description 按判定结果抛出可分派状态码的错误（与 PR-E0.7 读侧同口径：拒绝必须是 4xx）
 * @param {{allowed: Boolean, reason: String}} decision decideContact 的结果
 * @throws {Error} 带 statusCode 的错误：401 无身份，403 其余拒绝
 * @returns {void}
 */
export function assertContact(decision) {
    if (decision?.allowed) {
        return
    }
    const reason = decision?.reason || 'denied'
    const messages = {
        'no-user': '缺少有效的用户身份（userCode）',
        'no-target': 'targetUserCode不能为空',
        'upstream-error': '关系校验暂不可用，请稍后再试',
        'self-not-allowed': '不能和自己聊天',
        'no-relation': '无权与该用户建立会话',
    }
    const err = new Error(messages[reason] || `无权与该用户建立会话（${reason}）`)
    err.statusCode = reason === 'no-user' ? 401 : 403
    err.contactReason = reason
    throw err
}

export default {decideContact, assertContact}
