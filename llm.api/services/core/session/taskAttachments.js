/**
 * @fileOverview 任务附件授权通道判据（纯函数族，B-1，属主拍板②附件 B）
 * @module services/core/session/taskAttachments
 * @description
 * 设计 §3-待决:105 的兑现件："fileCode 作用域须绑定发起 userCode，child 读文件走 messageScope
 * 同款归属校验，不能任意 fileCode 可读"。B-2 当年封的是后门（agentChat 透传 attachments 进
 * `agent:` 隔离会话档案）；这一刀开的是**前门**：
 *
 * 1. 授权快照在 root：taskMode 提交时 `root.params.attachments` 已带用户本会话的 FileInfo 原样
 *    （taskQueueComposer.buildRootTask 既有形状）——"谁在哪个会话发起、带了哪些文件"从提交
 *    那一刻就是任务行上的事实，child 的权限面**只读这份快照**，不现查会话列表；
 * 2. 判定是纯函数：taskContext 缺席（普通轮）拒、快照空/root 读不到拒、fileCode 不在快照拒；
 *    "不知道"站危险面（与写面幂等闸、recoverPolicy 同一保守取向）；
 * 3. 列表注入是 child 知道 fileCode 的唯一途径：agentChat 把快照格式化成查询后缀交回模型，
 *    模型只能引用**清单里**的把手——清单外的 fileCode 就算被调用也在第 2 条被拒。
 *
 * 普通 chat 轮不走这里（tool 只在有 taskContext 时注册）；turnRunner 的忠实重放也不经此面。
 */

/**
 * 从消息 attachments（FileInfo[]）提取授权快照。
 * 只认 fileCode 非空串的项；按 fileCode 去重（先出现者胜，name 取先者）；无 name 留空不猜。
 * @param {Array} attachments message/root params 里的附件数组
 * @returns {Array<{fileCode: String, name: String}>}
 */
export function snapshotAttachmentAccess(attachments = []) {
    if (!Array.isArray(attachments)) return []
    const seen = new Set()
    const list = []
    for (const a of attachments) {
        const fileCode = typeof a?.fileCode === 'string' ? a.fileCode.trim() : ''
        if (!fileCode || seen.has(fileCode)) continue
        seen.add(fileCode)
        list.push({fileCode, name: typeof a?.name === 'string' ? a.name : ''})
    }
    return list
}

/** 拒绝档位回给模型的话（每档可辨别——"没有附件"与"没权限"与"账读不动"是三句真话） */
export const DENY_MESSAGES = {
    'no-task-context': 'read_attachment 仅在任务模式可用（本会话的普通轮请直接用上下文里的内容）',
    'root-unreadable': '任务归属账暂不可读，本次未读取附件（请稍后重试）',
    'no-snapshot': '本任务没有登记可用的发起附件',
    'bad-file-code': 'fileCode 必须是非空字符串',
    'not-in-snapshot': '该 fileCode 不在本任务发起会话登记的附件清单内，拒绝读取（附件授权红线）',
}

/**
 * 归属判定表（纯函数，IO 全在调用方）。
 * @param {Object} p
 * @param {Object|null} p.taskContext run 的任务上下文（{rootCode,...}；普通轮为 null）
 * @param {String} p.fileCode 请求读的把手
 * @param {Array|null} p.snapshot root 的授权快照（root 读不到传 null=不知道）
 * @returns {{allow: Boolean, reason: String, message?: String}}
 */
export function decideAttachmentAccess({taskContext = null, fileCode = '', snapshot = null} = {}) {
    if (!taskContext?.rootCode) return {allow: false, reason: 'no-task-context', message: DENY_MESSAGES['no-task-context']}
    const code = typeof fileCode === 'string' ? fileCode.trim() : ''
    if (!code) return {allow: false, reason: 'bad-file-code', message: DENY_MESSAGES['bad-file-code']}
    if (!snapshot) return {allow: false, reason: 'root-unreadable', message: DENY_MESSAGES['root-unreadable']}
    if (snapshot.length === 0) return {allow: false, reason: 'no-snapshot', message: DENY_MESSAGES['no-snapshot']}
    if (!snapshot.some((a) => a.fileCode === code)) {
        return {allow: false, reason: 'not-in-snapshot', message: DENY_MESSAGES['not-in-snapshot']}
    }
    return {allow: true, reason: 'in-snapshot', fileCode: code}
}

/**
 * 给 child 的查询后缀：把授权清单如实摊开（模型只有从这里才能知道 fileCode）。
 * 空清单返回空串——调用方不拼接，query 逐字不变。
 * @param {Array} snapshot snapshotAttachmentAccess 的产物
 * @param {String} [toolName] 读面工具名（注入文案与注册名单源一致）
 * @returns {String}
 */
export function formatAttachmentsNote(snapshot = [], toolName = 'read_attachment') {
    if (!Array.isArray(snapshot) || snapshot.length === 0) return ''
    const lines = snapshot.map((a) => `- ${a.name || '(未具名)'}（fileCode=${a.fileCode}）`)
    return `\n\n可用附件（本任务发起会话上传，仅这些可用 ${toolName} 按 fileCode 读取）：\n${lines.join('\n')}`
}

export default {snapshotAttachmentAccess, decideAttachmentAccess, formatAttachmentsNote, DENY_MESSAGES}
