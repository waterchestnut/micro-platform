/**
 * @fileOverview 操作mongodb中的artifact登记账本
 * @module daos/core/dac/artifactDac
 * @description
 * intake 编排（services/core/artifact/artifactIntake）生产接线的落库实现：
 * createStarted→deps.createRow，casState→deps.casState，setRegisterResult→deps.finalizeRegister。
 * 注意 casState 是**条件更新**（state:from 不匹配即 0 行）——编排挡合法转移，这里挡并发/重放，
 * 两层各管各的：编排管"这步该不该走"，CAS 管"账还是我以为的样子吗"。
 */

import {Artifact} from '../schema/index.js'
import BaseDac from './BaseDac.js'

export class ArtifactDac extends BaseDac {
    constructor(Model) {
        super(Model, 'artifactCode')
    }

    /**
     * @description 建 started 账行（create-once：已存在则原样返回，重放不多行）
     * @param {Object} task intake 任务（artifactCode/conversationCode/userCode/sandboxId/path/name 等）
     * @returns {Promise<Object>} 账行
     */
    async createStarted(task = {}) {
        if (!task.artifactCode) {
            throw new Error('artifactCode 不能为空')
        }
        return await Artifact.findOneAndUpdate(
            {artifactCode: task.artifactCode},
            {
                $setOnInsert: {
                    artifactCode: task.artifactCode,
                    conversationCode: task.conversationCode || '',
                    channel: task.channel || '',
                    userCode: task.userCode || '',
                    runCode: task.runCode || '',
                    toolCallId: task.toolCallId || '',
                    idempotencyKey: task.idempotencyKey || undefined,
                    name: task.name || '',
                    kind: task.kind || 'file',
                    mimeType: task.mimeType || '',
                    version: task.version || 1,
                    parentArtifactCode: task.parentArtifactCode || '',
                    lineageRootArtifactCode: task.lineageRootArtifactCode || task.artifactCode,
                    sandboxId: task.sandboxId || '',
                    sourcePath: task.path || '',
                    operator: task.operator,
                    insertTime: new Date(),
                },
                $set: {updateTime: new Date()},
            },
            {upsert: true, new: true, setDefaultsOnInsert: true},
        )
    }

    /**
     * @description 状态 CAS：只有账上还停在 from 才允许推到 to；不匹配即抛（并发/重放信号，不是可吞的错）
     * @param {String} artifactCode 产物标识
     * @param {String|null} from 期望的当前状态（null=不限，仅终态补写用）
     * @param {String} to 目标状态
     * @returns {Promise<Object>} 更新后的行
     */
    async casState(artifactCode, from, to) {
        const filter = {artifactCode}
        if (from !== null && from !== undefined) {
            filter.state = from
        }
        const doc = await Artifact.findOneAndUpdate(filter, {$set: {state: to, updateTime: new Date()}}, {new: true})
        if (!doc) {
            const cur = await Artifact.findOne({artifactCode}).lean()
            throw new Error(`artifact ${artifactCode} 状态 CAS ${from}→${to} 未命中（当前=${cur ? cur.state : '无此行'}）`)
        }
        return doc
    }

    /**
     * @description §9.5 第 3 步"登记"：把 doc.api 把手与实测内容事实写进行（状态推进由 casState 负责）
     * @param {String} artifactCode 产物标识
     * @param {Object} meta {fileCode,fileUrl,sizeBytes,sha256}
     * @returns {Promise<Object>} 更新后的行
     */
    async setRegisterResult(artifactCode, meta = {}) {
        return await Artifact.findOneAndUpdate(
            {artifactCode},
            {$set: {
                fileCode: meta.fileCode || '',
                fileUrl: meta.fileUrl || '',
                sizeBytes: Number(meta.sizeBytes) || 0,
                sha256: meta.sha256 || '',
                readyAt: null,
                updateTime: new Date(),
            }},
            {new: true},
        )
    }

    /**
     * @description 补偿执行器 unregister-artifact：软删登记（对账据此把"行在但已注销"归为已处理）
     * @param {String} artifactCode 产物标识
     * @returns {Promise<Object|null>} 更新后的行
     */
    async markUnregistered(artifactCode) {
        return await Artifact.findOneAndUpdate(
            {artifactCode},
            {$set: {status: -1, updateTime: new Date()}},
            {new: true},
        )
    }

    /**
     * @description 进 ready 时盖 readyAt（事件投递时刻，与 state=ready 的账位分离：ready 先落账、事件后发）
     * @param {String} artifactCode 产物标识
     * @returns {Promise<Object|null>} 更新后的行
     */
    async stampReadyAt(artifactCode) {
        return await Artifact.findOneAndUpdate(
            {artifactCode},
            {$set: {readyAt: new Date(), updateTime: new Date()}},
            {new: true},
        )
    }

    /**
     * @description 会话内某名的最新版本（read_artifact 把手解析用）
     * @param {String} conversationCode 会话标识
     * @param {String} name 文件名
     * @returns {Promise<Object|null>} 行
     */
    async latestByName(conversationCode, name) {
        return await Artifact.findOne({conversationCode, name, status: 0}).sort({version: -1, insertTime: -1}).lean()
    }

    /**
     * @description 整条版本链（§5 line 470：跨人链要逐行显示作者，作者就在行上）
     * @param {String} lineageRootArtifactCode 链根
     * @returns {Promise<Object[]>} 按版本升序
     */
    async listLineage(lineageRootArtifactCode) {
        return await Artifact.find({lineageRootArtifactCode, status: 0}).sort({version: 1}).lean()
    }

    /**
     * @description 对账扫描①：非终态且超宽限的账行（在途→孤儿的候选面，只取数不动手）
     * @param {Date} olderThan 宽限线
     * @param {Number} [limit] 批量上限
     * @returns {Promise<Object[]>} 行
     */
    async scanStalled(olderThan, limit = 200) {
        return await Artifact.find({
            state: {$in: ['started', 'pulled', 'uploaded']},
            status: 0,
            insertTime: {$lt: olderThan},
        }).sort({insertTime: 1}).limit(limit).lean()
    }

    /**
     * @description 按 doc.api fileCode 反查登记（双向对账的 doc→llm 方向入口）
     * @param {String} fileCode doc.api 文件标识
     * @returns {Promise<Object|null>} 行
     */
    async findByFileCode(fileCode) {
        if (!fileCode) return null
        return await Artifact.findOne({fileCode}).lean()
    }

    /**
     * @description read_artifact 的查账：按 artifactCode 取行，**含 status=-1**（注销要能如实报告，而不是伪装成"不存在"）
     * @param {String} artifactCode 产物标识
     * @returns {Promise<Object|null>} 行
     */
    async findByArtifactCode(artifactCode) {
        if (!artifactCode) return null
        return await Artifact.findOne({artifactCode}).lean()
    }
}

export default new ArtifactDac(Artifact)
