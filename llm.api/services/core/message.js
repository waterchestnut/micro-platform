/**
 * @fileOverview 会话消息相关的业务操作
 * @author xianyang 2025/10/15
 * @module
 */

import messageDac from '../../daos/core/dac/messageDac.js'
import conversationDac from '../../daos/core/dac/conversationDac.js'
import {resolveMessageScope} from './messageScope.js'
import retSchema from '../../daos/retSchema.js'

/**
 * 视图函数已搬到零依赖的 `./messageView.js`：那边一 import 就会 `import messageDac` →
 * 顶层 await 连 MongoDB，结果是**四个前端依赖的契约面从来没有一条测试**。搬出来之后
 * `test/services/core/messageView.test.js` 才进得去（底座这次同步的就是这一刀的形状）。
 * 这里再导出同名符号：既有调用方（`rows.map(toMessageView)` 以及外部按 message.js 引这两个函数的地方）
 * 一行都不用改。
 */
import {toMessageView, toProcessSummary} from './messageView.js'
import {findOverflow, buildToolResultPayload} from '../../tools/overflow.js'

export {toMessageView, toProcessSummary} from './messageView.js'

const tools = llm.tools
const logger = llm.logger
const config = llm.config

/**
 * @description 获取会话消息信息
 * @author xianyang
 * @param {String} messageCode 会话消息标识
 * @returns {Promise<Object>} 会话消息元数据详细信息
 */
export async function getMessage(messageCode) {
    return messageDac.getByCode(messageCode, {extInfo: 0})
}

/**
 * @description 获取会话消息列表
 * @author xianyang
 * @param {Object} [filter] 筛选条件
 * @param {Number} [pageIndex=1] 页码
 * @param {Number} [pageSize=10] 分页大小
 * @param {Object} [options] 排序、格式化等参数
 * @param {Number} [options.total] 记录的总数（翻页时可省略总数的查询）
 * @param {{[key: string]:1 | -1}} [options.sort] 排序
 * @param {Object} [options.projection] 覆盖默认投影（默认剔除体积最大的 extInfo）
 * @returns {Promise<{total: Number, rows: [Object]}>} {total: 总数, rows: 消息数组}
 */
export async function getMessages(filter = {}, pageIndex = 1, pageSize = 10, options = {}) {
    let optionsIn = {...filter, projection: options.projection || {extInfo: 0}}
    if (options.sort) {
        optionsIn.sort = options.sort
    } else {
        optionsIn.sort = {insertTime: -1}
    }
    if (options.total) {
        optionsIn.total = options.total
    }
    return messageDac.getByPage(pageIndex, pageSize, optionsIn)
}



/**
 * @description 获取供调用方展示的消息分页，不含发给模型的 messages 提示词
 * @author xianyang
 * @param {Object} [filter] 筛选条件（来自请求体，不可信，必须经可见性收敛）
 * @param {Number} [pageIndex=1] 页码
 * @param {Number} [pageSize=10] 分页大小
 * @param {Object} [options] 排序等参数
 * @param {Object} [curUserInfo] **当前登录用户**；缺失即拒绝（此前 filter 直接来自请求体，任何人可读全站问答）
 * @returns {Promise<{total: Number, rows: [Object]}>} 视图化的分页结果
 */
export async function getMessagePage(filter = {}, pageIndex = 1, pageSize = 10, options = {}, curUserInfo = {}) {
    const userCode = curUserInfo?.userCode
    /** 可见性按"会话成员制"判定，与 /core/conversation/list 同口径（conversationDac 的 $or: userCodes / operator.userCode） */
    const allowedCodes = userCode ? await conversationDac.getConversationCodes({userCode}) : []
    const scope = resolveMessageScope(filter, userCode, allowedCodes)
    if (!scope.ok) {
        /**
         * 状态码必须是 4xx 而不是 500：越权尝试要能被网关与监控按"拒绝"归类。
         * `format-reply.js` 的 setErrorHandler 取 `error.statusCode || 500`，裸 throw 会把越权伪装成服务异常。
         */
        const err = new Error(scope.reason === 'not-member' ? '无权访问该会话' : '缺少有效的用户身份（userCode）')
        err.statusCode = scope.reason === 'not-member' ? 403 : 401
        throw err
    }
    if (tools.isArray(scope.filter.conversationCode) && !scope.filter.conversationCode.length) {
        return {total: 0, rows: []}
    }
    const ret = await getMessages(scope.filter, pageIndex, pageSize, {...options, projection: {messages: 0}})
    return {
        total: ret?.total || 0,
        rows: (ret?.rows || []).map(toMessageView),
    }
}

/**
 * @description 按 ref 取回某条工具结果的留档全文（PR-H H3 第二半，只读）
 * @param {Object} curUserInfo 当前登录用户
 * @param {Object} body 请求体
 * @param {String} body.messageCode 消息标识
 * @param {String} body.ref 留档标识（即 tool_call_id）
 * @param {Number} [body.offset] 起始字符
 * @param {Number} [body.limit] 长度
 * @returns {Promise<Object>} `buildToolResultPayload` 的结果
 *
 * 权限门**不自写**：成员制判定复用 `resolveMessageScope`，与 `/core/message/list` 同一口径。
 * 但**对外的状态码在这里刻意合并**："行不存在"与"存在但不属于你"都回 404，
 * 只在日志里留下区分（`reason:'not-member'`）。理由是这条路由是本仓**第一处**
 * 会按单个 messageCode 回答"有没有这一条"的接口：若两种情况各回一种码，
 * 已登录用户就能拿它枚举别人的消息是否存在——而 `/core/message/list` 因为做交集，
 * 从来没有这个口子。合并成 404 不会掩盖问题：审计侧看得到真实原因。
 * 身份缺失仍是 401（它不构成存在性信号），且状态码必须显式给 4xx
 * （`format-reply` 取 `error.statusCode || 500`），否则一次越权探测会伪装成服务异常——
 * 这条纪律来自 §2D.2 那次的同类错误。
 */
export async function getToolResult(curUserInfo = {}, body = {}) {
    const {messageCode, ref, offset, limit} = body
    const userCode = curUserInfo?.userCode
    /**
     * 判定顺序是刻意的：**先问身份，再问行在不在，最后问成不成员**。
     * 反过来（先查行）会让"没有身份"的请求拿到 404 而不是 401，
     * 那等于把一个未登录探测者当成合法调用方来回答"这条消息存不存在"——标识 enumeration 的入口。
     */
    if (!userCode) {
        const err = new Error('缺少有效的用户身份（userCode）')
        err.statusCode = 401
        throw err
    }
    const row = await messageDac.getByCode(messageCode)
    /** 行不存在与不属于同一码，见函数头：不给"按 messageCode 枚举存在性"留口子 */
    if (!row) {
        const err = new Error('消息不存在')
        err.statusCode = 404
        throw err
    }
    const allowedCodes = await conversationDac.getConversationCodes({userCode})
    const scope = resolveMessageScope({conversationCode: row.conversationCode}, userCode, allowedCodes)
    if (!scope.ok) {
        /** 审计侧留下真实原因，对外只说"不存在" */
        logger.warn(`/core/message/tool-result 拒绝：reason=${scope.reason}, userCode=${userCode}, messageCode=${messageCode}`)
        const err = new Error('消息不存在')
        err.statusCode = 404
        throw err
    }
    const list = row.extInfo?.toolOverflows || []
    return buildToolResultPayload({entry: findOverflow(list, ref), ref, offset, limit})
}

/*对大模型回答内容进行喜欢或不喜欢的反馈*/
export async function feedback(curUserInfo, messageCode, like) {
    let messageInfo = await messageDac.getByCode(messageCode)
    if (messageInfo?.operator?.userCode !== curUserInfo.userCode) {
        throw new Error(`会话消息不存在`)
    }

    if (!like) {
        like = 0
    }

    return messageDac.upsert({answerFeedback: like, messageCode})
}