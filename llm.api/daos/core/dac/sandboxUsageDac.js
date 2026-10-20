/**
 * @fileOverview 操作mongodb中的sandboxUsage
 * @module daos/core/dac/sandboxUsageDac
 */

import {SandboxUsage} from '../schema/index.js'
import BaseDac from './BaseDac.js'

export class SandboxUsageDac extends BaseDac {
    constructor(Model) {
        super(Model, 'sandboxId')
    }

    /**
     * @description 按 sandboxId 落一条用量（重复上报覆盖，不产生多行）
     * @param {Object} info 用量记录
     * @returns {Promise<Object|null>} 落库后的记录
     */
    async upsertBySandboxId(info = {}) {
        if (!info.sandboxId) {
            throw new Error('sandboxId 不能为空')
        }
        return await SandboxUsage.findOneAndUpdate(
            {sandboxId: info.sandboxId},
            {$set: {...info, updateTime: new Date()}, $setOnInsert: {insertTime: new Date()}},
            {upsert: true, new: true, setDefaultsOnInsert: true},
        )
    }

    /**
     * @description 汇总某会话的沙箱用量（message.totalPrice 的数据来源）
     * @param {String} conversationCode 会话标识
     * @param {Date} since 窗口起点
     * @returns {Promise<Object>} {seconds, price, sandboxes}
     */
    async sumConversation(conversationCode, since) {
        const rows = await SandboxUsage.aggregate([
            {$match: {conversationCode, startedAt: {$gte: since}}},
            {$group: {_id: null, seconds: {$sum: '$seconds'}, price: {$sum: '$price'}, sandboxes: {$sum: 1}}},
        ])
        const hit = rows[0] || {}
        return {seconds: Number(hit.seconds) || 0, price: Number(hit.price) || 0, sandboxes: Number(hit.sandboxes) || 0}
    }

    /**
     * @description 一次聚合同时拿到"用户窗口总秒数/台数"和"本会话已用秒数"
     *
     * 为什么要本会话单独一份：配额拦下重复建箱时，模型/前端要能看到"这台已经用了多久"，
     * 只给总量会让人以为是自己被别人占了。
     * @param {String} userCode 用户标识
     * @param {Date} since 窗口起点
     * @param {String} [conversationCode] 会话标识
     * @returns {Promise<Object>} {userSeconds, userSandboxes, convSeconds}
     */
    async sumWindow(userCode, since, conversationCode = '') {
        const rows = await SandboxUsage.aggregate([
            {$match: {userCode, startedAt: {$gte: since}}},
            /** 先按会话归并，避免同一会话多台的秒数被 conversation 维度重复计入 */
            {$group: {_id: '$conversationCode', seconds: {$sum: '$seconds'}, sandboxes: {$sum: 1}}},
            /** 再一次算出用户总量与目标会话的量 */
            {$group: {
                _id: null,
                userSeconds: {$sum: '$seconds'},
                userSandboxes: {$sum: '$sandboxes'},
                convAll: {$push: {c: '$_id', s: '$seconds'}},
            }},
        ])
        const hit = rows[0] || {}
        let convSeconds = 0
        for (const item of hit.convAll || []) {
            if (item.c === conversationCode) {
                convSeconds = item.s
            }
        }
        return {
            userSeconds: Number(hit.userSeconds) || 0,
            userSandboxes: Number(hit.userSandboxes) || 0,
            convSeconds,
        }
    }
}

export default new SandboxUsageDac(SandboxUsage)
