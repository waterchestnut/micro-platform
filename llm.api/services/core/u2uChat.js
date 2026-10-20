/**
 * @fileOverview 用户间聊天（u2u）相关的业务操作
 * @author xianyang 2026/08/08
 * @module
 */

import conversationDac from '../../daos/core/dac/conversationDac.js'
import messageDac from '../../daos/core/dac/messageDac.js'
import {getUserDetail, getUserList} from '../../grpc/clients/userInfo.js'
import {md5} from "../../tools/security.js";

const tools = llm.tools
const logger = llm.logger

const U2U_CHANNEL = 'u2u'
const U2U_CHANNEL_GROUP = 'im'
const MAX_CONTENT_LENGTH = 2000

/**
 * @description 根据用户标识生成u2u对话的唯一标识（与顺序无关）
 * @param {String} userCode1
 * @param {String} userCode2
 * @returns {String}
 */
export function genConversationCode(userCode1, userCode2) {
    const arr = [userCode1 + '', userCode2 + ''].sort();
    return md5('u2u|' + arr.join('|'));
}

/*校验当前用户是否为会话成员*/
export async function assertMember(conversationCode, userCode) {
    const conv = await conversationDac.getByCode(conversationCode)
    if (!conv || conv.status === -1 || conv.conversationType !== 'u2u' || !conv.userCodes?.includes(userCode)) {
        throw new Error('无权访问该会话')
    }
    return conv
}

/*获取会话中对端用户标识*/
function getTargetUserCode(conv, curUserCode) {
    return conv.userCodes?.find(_ => _ !== curUserCode) || null
}

/*解析用户信息（不存在或查询失败返回null）*/
async function resolveUser(userCode) {
    try {
        const user = await getUserDetail(userCode)
        return user?.userCode ? user : null
    } catch (err) {
        return null
    }
}

/*批量解析用户信息（查询失败返回空表，不阻断会话列表）*/
async function resolveUsers(userCodes) {
    const map = {}
    const codes = [...new Set(userCodes.filter(Boolean))]
    if (!codes.length) {
        return map
    }
    try {
        const users = await getUserList(codes)
        users?.forEach(user => {
            if (user?.userCode) {
                map[user.userCode] = user
            }
        })
    } catch (err) {
        logger.warn(`u2u批量获取用户信息失败: ${err.message}`)
    }
    return map
}

/*批量计算各会话中指定用户的未读数（对方发送且未读的消息数）*/
async function getUnreadCounts(conversationCodes, userCode) {
    const map = {}
    if (!conversationCodes.length) {
        return map
    }
    const stats = await messageDac.aggregate([
        {
            $match: {
                conversationCode: {$in: conversationCodes},
                status: {$ne: -1},
                'operator.userCode': {$ne: userCode},
                'extInfo.readStatus': {$ne: true},
            }
        },
        {
            $group: {
                _id: '$conversationCode',
                count: {
                    $sum: 1,
                },
            },
        },
    ])
    stats?.forEach(_ => {
        map[_._id] = _.count
    })
    return map
}

/*获取或创建u2u会话（会话标识由genConversationCode确定，不存在时创建）*/
async function getOrCreateConversation(curUserInfo, targetUser) {
    const targetUserCode = targetUser.userCode
    const conversationCode = genConversationCode(curUserInfo.userCode, targetUserCode)
    const defaultTitle = `${curUserInfo.realName || curUserInfo.userCode} 与 ${targetUser.realName || targetUserCode}`

    const conv = await conversationDac.getOrCreateByConversationCode(conversationCode, {
        conversationCode,
        conversationType: 'u2u',
        channel: U2U_CHANNEL,
        channelGroup: U2U_CHANNEL_GROUP,
        userCodes: [curUserInfo.userCode, targetUserCode],
        title: defaultTitle,
        operator: {userCode: curUserInfo.userCode, realName: curUserInfo.realName},
        status: 0,
    })

    /*兼容存量已软删除的u2u会话，重新激活*/
    if (conv.status === -1) {
        await conversationDac.update({
            conversationCode,
            status: 0,
            title: defaultTitle,
            userCodes: [curUserInfo.userCode, targetUserCode],
        }, {conversationCode, status: -1})
        return await conversationDac.getByCode(conversationCode)
    }
    return conv
}

/**
 * @description 获取我的u2u会话列表
 * @param {Object} curUserInfo 当前登录用户信息
 * @param {Object} [filter] 筛选条件：keyword
 * @param {Number} [pageIndex=1] 页码
 * @param {Number} [pageSize=10] 分页大小
 * @returns {Promise<{total: Number, rows: [Object]}>}
 */
export async function getU2uConversationList(curUserInfo, filter = {}, pageIndex = 1, pageSize = 10) {
    const optionsIn = {
        userCode: curUserInfo.userCode,
        conversationType: 'u2u',
        sort: {updateTime: -1},
    }
    if (tools.isExist(filter.keyword)) {
        optionsIn.complexFilter = {
            title: {$regex: new RegExpExt(filter.keyword, 'i', true)},
        }
    }

    const {total, rows} = await conversationDac.getByPage(pageIndex, pageSize, optionsIn)
    if (!rows?.length) {
        return {total, rows: []}
    }

    /*批量取每个会话的最后一条消息*/
    const codes = rows.map(_ => _.conversationCode)
    const lastMessageMap = {}
    const lastStats = await messageDac.aggregate([
        {$match: {conversationCode: {$in: codes}, status: {$ne: -1}}},
        {$sort: {insertTime: -1}},
        {
            $project: {
                messageCode: 1,
                conversationCode: 1,
                query: 1,
                'operator.userCode': 1,
                insertTime: 1,
            }
        },
        {$group: {_id: '$conversationCode', lastMessage: {$first: '$$ROOT'}}},
    ])
    lastStats?.forEach(stat => {
        lastMessageMap[stat._id] = stat.lastMessage
    })

    const targetUserMap = await resolveUsers(rows.map(conv => getTargetUserCode(conv, curUserInfo.userCode)))
    const unreadMap = await getUnreadCounts(codes, curUserInfo.userCode)

    const list = rows.map(conv => {
        const last = lastMessageMap[conv.conversationCode]
        const targetUserCode = getTargetUserCode(conv, curUserInfo.userCode)
        return {
            conversation: {
                conversationCode: conv.conversationCode,
                title: conv.title,
                updateTime: conv.updateTime,
            },
            targetUser: (targetUserCode && targetUserMap[targetUserCode]) || (targetUserCode ? {userCode: targetUserCode} : null),
            lastMessage: last ? {
                messageCode: last.messageCode,
                content: last.query,
                sender: last.operator?.userCode,
                sendTime: last.insertTime,
            } : null,
            unreadCount: unreadMap[conv.conversationCode] || 0,
        }
    })
    return {total, rows: list}
}

/*序列化消息*/
function serializeMessage(messageInfo) {
    return {
        messageCode: messageInfo.messageCode,
        conversationCode: messageInfo.conversationCode,
        content: messageInfo.query,
        sender: {
            userCode: messageInfo.operator?.userCode,
            realName: messageInfo.operator?.realName,
            avatarUrl: messageInfo.operator?.avatarUrl,
        },
        messageType: messageInfo.extInfo?.messageType || 'text',
        readStatus: !!messageInfo.extInfo?.readStatus,
        attachments: messageInfo.attachments || [],
        insertTime: messageInfo.insertTime,
    }
}

/*序列化消息（附带是否本人发送）*/
function serializeMessageForUser(messageInfo, userCode) {
    return {
        ...serializeMessage(messageInfo),
        fromMe: messageInfo.operator?.userCode === userCode,
    }
}

/**
 * @description 发送u2u消息（会话不存在时按双方用户标识自动创建）
 * @param {Object} curUserInfo 当前登录用户信息
 * @param {Object} [params] 参数
 * @param {String} params.targetUserCode 接收者用户标识
 * @param {String} params.content 消息内容
 * @param {String} [params.messageCode] 前端预生成的消息标识（幂等）
 * @param {String} [params.messageType] 消息类型：text/image/file
 * @param {Array} [params.attachments] 附件信息（FileInfo）
 * @returns {Promise<Object>} 消息对象
 */
export async function sendU2uMessage(curUserInfo, params = {}) {
    const {targetUserCode, content, messageCode, messageType, attachments} = params
    if (!tools.isExist(content) && !attachments.length) {
        throw new Error('消息内容不能为空')
    }
    if (tools.isExist(content) && content.length > MAX_CONTENT_LENGTH) {
        throw new Error(`消息内容不能超过${MAX_CONTENT_LENGTH}字`)
    }
    if (!tools.isExist(targetUserCode)) {
        throw new Error('targetUserCode不能为空')
    }
    if (targetUserCode === curUserInfo.userCode) {
        throw new Error('不能和自己聊天')
    }

    const targetUser = await resolveUser(targetUserCode)
    if (!targetUser) {
        throw new Error('目标用户不存在')
    }

    const conversationCode = genConversationCode(curUserInfo.userCode, targetUserCode)
    const conv = await getOrCreateConversation(curUserInfo, targetUser)

    const msgCode = messageCode || tools.getUUID()
    const exist = await messageDac.getByCode(msgCode)
    if (exist) {
        return serializeMessageForUser(exist, curUserInfo.userCode)
    }

    const messageInfo = await messageDac.add({
        messageCode: msgCode,
        conversationCode,
        channel: conv.channel || U2U_CHANNEL,
        channelGroup: conv.channelGroup || U2U_CHANNEL_GROUP,
        query: content,
        progress: 'finish',
        operator: {
            userCode: curUserInfo.userCode,
            realName: curUserInfo.realName,
            avatarUrl: curUserInfo.avatarUrl,
        },
        status: 0,
        attachments,
        extInfo: {messageType: messageType || 'text', readStatus: false},
    })

    /*刷新会话updateTime，用于会话列表按最近活跃排序*/
    await conversationDac.update({conversationCode})

    /*通知对方（推送失败不阻断，前端可轮询兜底）*/
    /*const otherUsers = (conv.userCodes || []).filter(_ => _ !== curUserInfo.userCode)*/
    /*await publishU2uEvent(conversationCode, otherUsers, 'message', serializeMessage(messageInfo))
        .catch(err => logger.error(`u2u 消息推送失败: ${err.message}`))*/

    return serializeMessageForUser(messageInfo, curUserInfo.userCode)
}

/**
 * @description 获取u2u会话消息列表（支持分页及增量游标）
 * @param {Object} curUserInfo 当前登录用户信息
 * @param {Object} [params] 参数
 * @param {String} [params.conversationCode] 会话标识（与targetUserCode二选一）
 * @param {String} [params.targetUserCode] 对方用户标识（与conversationCode二选一，传入时按双方用户标识确定会话）
 * @param {Number} [params.pageIndex=1] 页码
 * @param {Number} [params.pageSize=20] 分页大小
 * @param {String} [params.afterInsertTime] 增量游标（时间）
 * @param {String} [params.beforeInsertTime] 向上翻页游标
 * @returns {Promise<{total: Number, rows: [Object]}>}
 */
export async function getU2uMessages(curUserInfo, params = {}) {
    const {conversationCode, targetUserCode, pageIndex = 1, pageSize = 20, afterInsertTime, beforeInsertTime} = params

    /*未传conversationCode时，按双方用户标识确定会话标识*/
    let code = conversationCode
    if (!tools.isExist(code) && tools.isExist(targetUserCode)) {
        code = genConversationCode(curUserInfo.userCode, targetUserCode)
    }
    if (!tools.isExist(code)) {
        throw new Error('conversationCode或targetUserCode不能为空')
    }
    await assertMember(code, curUserInfo.userCode)

    const {total, rows} = await messageDac.getByPage(pageIndex, pageSize, {
        conversationCode: code,
        afterInsertTime,
        beforeInsertTime,
        sort: {insertTime: 1},
    })
    return {
        total,
        rows: (rows || []).map(_ => serializeMessageForUser(_, curUserInfo.userCode)),
    }
}

/**
 * @description 标记会话消息已读（按消息粒度记录已读状态）
 * @param {Object} curUserInfo 当前登录用户信息
 * @param {Object} [params] 参数
 * @param {String} params.conversationCode 会话标识
 * @param {String} [params.upToTime] 读到的时间点，默认当前时间
 * @returns {Promise<Object>} {conversationCode, readTime}
 */
export async function readU2uMessages(curUserInfo, params = {}) {
    const {conversationCode, upToTime} = params
    const conv = await assertMember(conversationCode, curUserInfo.userCode)

    const readTime = upToTime ? new Date(upToTime) : new Date()
    const filter = {
        conversationCode,
        status: {$ne: -1},
        'operator.userCode': {$ne: curUserInfo.userCode},
        'extInfo.readStatus': {$ne: true},
    }
    if (upToTime) {
        filter.insertTime = {$lte: readTime}
    }
    await messageDac.update({extInfo: {readStatus: true, readTime}}, filter, {}, true)

    /*已读回执通知对方（可选）*/
    /* const otherUsers = (conv.userCodes || []).filter(_ => _ !== curUserInfo.userCode)*/
    /*await publishU2uEvent(conversationCode, otherUsers, 'read', {upToTime: readTime})
        .catch(err => logger.error(`u2u 已读推送失败: ${err.message}`))*/

    return {conversationCode, readTime}
}

/**
 * @description 删除u2u消息（软删除，仅本人消息）
 * @param {Object} curUserInfo 当前登录用户信息
 * @param {Object} [params] 参数
 * @param {String} params.messageCode 消息标识
 * @returns {Promise<Object>} {messageCode, deleted}
 */
export async function deleteU2uMessage(curUserInfo, params = {}) {
    const {messageCode} = params
    const messageInfo = await messageDac.getByCode(messageCode)
    if (!messageInfo || messageInfo.status === -1 || messageInfo.operator?.userCode !== curUserInfo.userCode) {
        throw new Error('无权删除该消息')
    }
    await messageDac.update({messageCode, status: -1}, {messageCode, status: 0})
    return {messageCode, deleted: true}
}

/**
 * @description 向指定用户发布u2u实时事件（Redis pub/sub）
 * @author xianyang
 * @param {String} conversationCode 会话标识
 * @param {Array} targetUserCodes 目标用户标识列表
 * @param {String} event 事件类型：message/read
 * @param {Object} data 业务数据
 */
/*export async function publishU2uEvent(conversationCode, targetUserCodes, event, data) {
    const payload = JSON.stringify({event, conversationCode, data, timestamp: new Date().toISOString()})
    await Promise.all((targetUserCodes || []).map(userCode => {
        return redisClient.client.publish(`u2u:msg:${userCode}`, payload)
    }))
}*/
