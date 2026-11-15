/**
 * @fileOverview 远程gRPC技能的结构
 * @author xianyang 2026/4/1
 * @module
 */

import mongoose from 'mongoose'
import StatusEnum from '../enum/StatusEnum.js'
import SkillReviewEnum from '../enum/SkillReviewEnum.js'
import Tag from '../definition/Tag.js'

const Schema = mongoose.Schema
const tools = llm.tools

/**
 * @description 定义grpcSkill的结构
 * @author xianyang
 * @property {String} skillCode 唯一标识
 * @property {String} skillName 技能名称
 * @property {String} skillMD 技能描述（SKILL.md格式）
 * @property {String} grpcHost 远程主机地址
 * @property {String} clientCode 所属应用标识
 * @property {String[]} channels 哪些聊天频道可以使用
 * @property {String} note 备注
 * @property {Schema.Types.Mixed} operator 创建者
 * @property {Number} status 状态：参见StatusEnum
 * @property {Schema.Types.Mixed[]} tags 标签，参见Tag
 * @property {Date} insertTime 创建时间
 * @property {Date} updateTime 最近更新时间
 */
const grpcSkillSchema = new Schema({
    skillCode: {
        type: String,
        default: function () {
            return tools.getUUID()
        },
        description: '技能标识',
        required: true
    },
    skillName: {type: String, description: '技能名称', required: true},
    skillMD: {type: String, description: '技能描述（SKILL.md格式）', required: true},
    grpcHost: {type: String, description: '远程主机地址', required: true},
    clientCode: {type: String, description: '所属应用标识', required: true},
    channels: {type: [String], description: '哪些聊天频道可以使用', required: true},
    note: {type: String, description: '备注'},
    operator: {type: Object, description: '创建者'},
    status: {type: Number, default: 0, description: '状态', enum: StatusEnum.toValues()},
    /**
     * 审核生命周期（PR-E0.1 ②）。**独立字段**，不挤 `status`：
     * 后者有 `-1` 软删语义并被 `BaseDac` 隐式过滤，把"待审"塞进去会让待审记录从管理端列表里消失，
     * 于是没人知道"有一条等着我批"（同 `MemoryStatusEnum` 文件头那条理由）。
     * 默认 pending ⇒ **新注册的技能默认不进任何用户上下文**，这正是这个洞的补法。
     */
    reviewStatus: {type: String, default: 'pending', description: '审核态：pending/approved/rejected/revoked', enum: SkillReviewEnum.toValues()},
    /** 谁批的：Object 而非 String——审计要能回答"哪个人、什么时候"，只留 userCode 会逼人去 join 才知道是谁 */
    reviewedBy: {type: Object, description: '审核人 {userCode, realName}；未审核时为 null'},
    reviewedAt: {type: Date, description: '审核时间；未审核时为 null'},
    reviewNote: {type: String, description: '审核说明（驳回/撤销的理由，回答"为什么批"）'},
    /**
     * 内容哈希（PR-E0.1 ⑤，防 rug pull）：批准针对的是**那一刻的正文**，
     * 装配时把存好的哈希与当前 skillMD 重算值比对，不一致 ⇒ 剔除 + 告警 + 审核态回 pending。
     * 用 md5 而不是 sha256：与本仓既有内容哈希一致（`checkpoint.js:43`、`memory/api.js:235`），
     * 这里的目的是**变更检测**，不是抗对抗性碰撞。
     */
    skillMDHash: {type: String, description: '批准时的 skillMD 内容哈希（md5，变更检测用）'},
    /** 内容版本号：每次正文变化 +1，让审计能说出"批的是第 3 版，现在跑的是第 5 版" */
    contentVersion: {type: Number, default: 0, description: '正文版本号（skillMD 每变一次 +1）'},
    tags: {type: [Tag], description: '标签'},
    insertTime: {
        type: Date, default: function () {
            return new Date()
        },
        description: '插入时间'
    },
    updateTime: {
        type: Date, default: function () {
            return new Date()
        },
        description: '最近更新时间'
    },
})

/**
 * @description 索引
 */
grpcSkillSchema.index({insertTime: 1})
grpcSkillSchema.index({updateTime: 1})
grpcSkillSchema.index({skillCode: 1})
grpcSkillSchema.index({skillName: 1})
grpcSkillSchema.index({grpcHost: 1})
grpcSkillSchema.index({clientCode: 1})
grpcSkillSchema.index({channels: 1})
grpcSkillSchema.index({'operator.userCode': 1})
grpcSkillSchema.index({'tags.key': 1})
grpcSkillSchema.index({'tags.value': 1})

export default grpcSkillSchema