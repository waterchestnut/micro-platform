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
    /**
     * ===== 功能目录扩展面（platform-feature-map Phase 0，D1~D6 已裁）=====
     * 声明纪律（本仓教训三连）：新字段必须声明进 schema，未声明=$set/bulkWrite 按 cast 静默丢。
     * 默认值全部"零行为"：老记录不回填、装配链不读这些字段时行为逐字不变——
     * 容器先于消费（Phase 1 的 platform_features 检索才吃它们）。
     */
    /** 目录三级效果（设计稿 §2）：guide=仅推荐引导；read=只读调用；write=有副作用（提案-确认-执行三段） */
    effectClass: {type: String, default: 'guide', enum: ['guide', 'read', 'write'], description: '功能效果级别'},
    /** 功能级权限点（属主 11-23 修正的两层模型：{clientCode}-browse=入口门，子系统内功能项另有细粒度 priv——
     *  本字段**只存功能级**，入口门不重复登记（由 browseGate+clientCode 推导，单源）；空数组=入口内公共 */
    featurePrivs: {type: [String], description: '功能级权限点（不含入口 browse；空=入口内公共）'},
    /** 入口门控事实（来源=ucenter client 注册表 needAuth2Show，注册时同步）：true=可见性需 hasPriv({clientCode}-browse) */
    browseGate: {type: Boolean, description: '入口是否受 {clientCode}-browse 门控（needAuth2Show 事实同步）'},
    /** 引导入口：url=主应用路由（/sub/{clientCode} 或主应用自身路由，D4 裁定禁子应用直链） */
    entry: {
        type: new Schema({
            subsystem: {type: String, description: '所属子系统 clientCode（主应用条目的 clientCode=部署实测值（xxzx/micro 等），不硬编——属主 11-23 修正）'},
            menuPath: {type: String, description: '菜单路径文案（兜底引导面）'},
            url: {type: String, description: '主应用内访问路由（相对主应用根；不含域名——域名归部署环境）'},
        }, {_id: false}),
        description: '功能入口（guide 级必填项，Phase 1 校验刀生效前允许缺席）',
    },
    /** 调用形状（read/write 消费面；Phase 1-3 才接线，此处只当容器） */
    invokeSpec: {
        type: new Schema({
            api: {type: String, description: '被调子系统接口标识（受控字典值，非自由 URL）'},
            paramsSchema: {type: Object, description: '入参 JSON Schema（服务端复验依据）'},
            timeoutMs: {type: Number, description: '调用超时'},
        }, {_id: false}),
        description: '功能调用规格',
    },
    /** 写面幂等键策略（接 skillWriteIdempotency 闸；Phase 3 名单登记时读） */
    idemKeyPolicy: {type: String, default: 'per-run', enum: ['per-run', 'explicit'], description: 'write 条目幂等键策略'},
    /** 注册源溯源（子系统 manifest；version 变更由哈希/探针驱动回 pending 的 D6 面） */
    sourceManifest: {
        type: new Schema({
            subsystemCode: {type: String, description: '注册来源子系统'},
            version: {type: String, description: 'manifest 版本'},
            stamp: {type: String, description: '内容戳（对齐 skillMDHash 家规）'},
        }, {_id: false}),
        description: '目录条目注册源',
    },
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