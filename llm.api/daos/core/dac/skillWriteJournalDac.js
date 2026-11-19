/**
 * @fileOverview skill 写面幂等账的落库层
 * @module daos/core/dac/skillWriteJournalDac
 * @description
 * 三笔动作对应判据的三个动作档：claim（execute 档的并发终裁）、lookup（replay/refuse 读账）、
 * settle（将 started 推成 done 并带快照）。
 * claim 的语义必须精确到"我是不是插入者"——用 `new:false` 的 findOneAndUpdate upsert：
 * **插入时返回 null（操作前无此文档），已存在时返回旧行**。少了这个区分，并发双跑就只是
 * 换了一种姿势发生（两个 worker 都看到 started 行、都认为"别人还在跑"或都去执行）。
 */

import {SkillWriteJournal} from '../schema/index.js'

export class SkillWriteJournalDac {
    /**
     * @description 按键查账（replay/refuse 判定的输入；读失败向上抛，由接线层兜成"闸门故障"话）
     * @param {String} key idempotencyKey
     * @returns {Promise<Object|null>} 行或 null
     */
    async lookup(key) {
        if (!key) return null
        return await SkillWriteJournal.findOne({idempotencyKey: key}).lean()
    }

    /**
     * @description create-once 认领：插入成功返回 null（我是认领人，可以去执行）；
     * 行已存在返回旧行（done ⇒ replay、started ⇒ 别人在途/崩溃残骸 ⇒ refuse）。
     * @param {Object} meta {key, runCode, toolCallId, toolName, conversationCode, userCode}
     * @returns {Promise<Object|null>} 旧行或 null
     */
    async claim(meta = {}) {
        if (!meta.key) {
            throw new Error('skillWriteJournal.claim: key 不能为空')
        }
        return await SkillWriteJournal.findOneAndUpdate(
            {idempotencyKey: meta.key},
            {
                $setOnInsert: {
                    idempotencyKey: meta.key,
                    runCode: meta.runCode || '',
                    toolCallId: meta.toolCallId || '',
                    toolName: meta.toolName || '',
                    conversationCode: meta.conversationCode || '',
                    userCode: meta.userCode || '',
                    /** 显式写 status：artifactDac 的 born-registered 教训（2026-11-15）——
                     *  函数名承诺 create-once-started，行为就不许寄望 schema 默认值 */
                    status: 'started',
                    resultSnapshot: '',
                    snapshotTruncated: false,
                    insertTime: new Date(),
                    updateTime: new Date(),
                },
            },
            {upsert: true, new: false},
        )
    }

    /**
     * @description 执行完成：started → done 并落快照。CAS 限定 status:'started'——
     * 已被对账/人工推进过的行不许被迟到的 settle 覆写。
     * @param {String} key idempotencyKey
     * @param {Object} snapshot {text, truncated}
     * @returns {Promise<Object|null>} 更新后的行（null=行不在或状态不是 started，如实暴露）
     */
    async settle(key, {text = '', truncated = false} = {}) {
        return await SkillWriteJournal.findOneAndUpdate(
            {idempotencyKey: key, status: 'started'},
            {$set: {status: 'done', resultSnapshot: text, snapshotTruncated: !!truncated, updateTime: new Date()}},
            {new: true},
        )
    }
}

export default new SkillWriteJournalDac()
