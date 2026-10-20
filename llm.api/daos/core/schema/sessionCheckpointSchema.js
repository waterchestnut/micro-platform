/**
 * @fileOverview 会话执行检查点的结构
 * @module daos/core/schema/sessionCheckpointSchema
 * @description 每次调用大模型前后各落一条，用于中断续跑与提示词前缀稳定性核对。
 * 与 `message` 的区别：`message` 是"这一轮问答的归档"，检查点是"这一轮内部每一次
 * 模型请求的现场"（工具循环可能迭代多次，只有检查点能还原到某个 iteration 的字节级上下文）。
 */

import mongoose from 'mongoose'
import StatusEnum from '../enum/StatusEnum.js'
import Tag from '../definition/Tag.js'

const Schema = mongoose.Schema
const tools = llm.tools

/**
 * @description 构造sessionCheckpoint的结构
 * @property {String} checkpointCode 唯一标识
 * @property {String} conversationCode 会话标识
 * @property {String} messageCode 本轮消息标识
 * @property {String} userCode 归属用户标识
 * @property {String} channel 频道标识
 * @property {Number} seq 会话内单调序号，用于折叠与排序
 * @property {Number} iteration 工具循环的第几次模型请求
 * @property {String} phase 阶段：preCreate|postCreate|postTools|final|abort
 * @property {String} messagesHash 发送消息序列的摘要，字节级一致才允许续跑
 * @property {Schema.Types.Mixed[]} messages 该次请求实际发送的完整消息序列
 * @property {Schema.Types.Mixed} toolState 工具现场 {pendingCalls, completedCalls}
 * @property {Schema.Types.Mixed} requestMeta 请求元信息 {model, tools, toolChoice}
 * @property {Schema.Types.Mixed} recallSnapshot 会话首帧冻结的记忆注入
 * @property {Number} profileDocVersion 会话首帧冻结的 owner 文档版本
 * @property {Schema.Types.Mixed} usage token 用量与预算快照
 * @property {String} answer 该次请求已产出的正文（postCreate 起有效）
 * @property {String} sandboxId 检查点时刻会话共享沙箱标识（续跑"文件系统可恢复"的 join key）
 * @property {Schema.Types.Mixed} operator 操作人
 * @property {Number} status 状态，参见StatusEnum
 * @property {Schema.Types.Mixed[]} tags 标签，参见Tag
 * @property {Date} insertTime 创建时间
 * @property {Date} updateTime 最后更新时间
 */
const sessionCheckpointSchema = new Schema({
    checkpointCode: {
        type: String,
        default: function () {
            return tools.getUUID()
        },
        description: '检查点标识',
        required: true
    },
    conversationCode: {type: String, description: '会话标识', required: true},
    messageCode: {type: String, description: '本轮消息标识'},
    userCode: {type: String, description: '归属用户标识'},
    channel: {type: String, description: '频道标识'},
    seq: {type: Number, default: 0, description: '会话内单调序号'},
    iteration: {type: Number, default: 0, description: '工具循环的第几次模型请求'},
    phase: {
        type: String,
        description: '阶段',
        enum: ['preCreate', 'postCreate', 'postTools', 'final', 'abort']
    },
    messagesHash: {type: String, description: '发送消息序列摘要'},
    messages: {type: [Object], description: '该次请求实际发送的消息序列'},
    toolState: {
        type: Object,
        description: '工具现场',
        default: function () {
            return {pendingCalls: [], completedCalls: []}
        }
    },
    requestMeta: {type: Object, description: '请求元信息'},
    recallSnapshot: {type: String, description: '会话首帧冻结的记忆注入文本'},
    recallAtomCodes: {type: [String], description: '会话首帧冻结的记忆标识'},
    profileDocVersion: {type: Number, description: '会话首帧冻结的 owner 文档版本'},
    usage: {type: Object, description: 'token 用量与预算快照'},
    answer: {type: String, description: '该次请求已产出的正文'},
    /** PR-16 ②：现场所属的会话级共享沙箱。续跑时"文件系统可恢复"的 join key：
     *  快照仓库按 `<sandboxId>-sandbox` 命名，凭它找回同一工作环境（§5.31）。 */
    sandboxId: {type: String, default: '', description: '检查点时刻会话共享沙箱标识'},
    operator: {type: Object, description: '操作人'},
    status: {type: Number, default: 0, description: '状态', enum: StatusEnum.toValues()},
    tags: {type: [Tag], description: '标签'},
    insertTime: {
        type: Date, default: function () {
            return new Date()
        },
        description: '创建时间'
    },
    updateTime: {
        type: Date, default: function () {
            return new Date()
        },
        description: '最后更新时间'
    },
})

/**
 * 标识与主查询路径：按会话取最后若干检查点
 */
sessionCheckpointSchema.index({checkpointCode: 1}, {unique: true})
sessionCheckpointSchema.index({conversationCode: 1, seq: -1})
sessionCheckpointSchema.index({conversationCode: 1, phase: 1})
sessionCheckpointSchema.index({messageCode: 1})
sessionCheckpointSchema.index({userCode: 1, channel: 1})
sessionCheckpointSchema.index({sandboxId: 1})
/** 检查点是执行现场而非档案，过期即可回收；message 归档不受此影响 */
sessionCheckpointSchema.index({insertTime: 1}, {expireAfterSeconds: 7 * 24 * 3600})

export default sessionCheckpointSchema
