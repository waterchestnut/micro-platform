/**
 * @fileOverview 产物（artifact）登记账本的结构
 * @module daos/core/schema/artifactSchema
 * @description
 * PR-H2 的落库面：一行 = 产物版本链上的一个版本。字段口径全部来自方案已有决定，不新发明：
 * - §7 line 733：plan 也是 artifact（`kind:'data'`，`name:'plan.json'/'progress.md'`，lineage.version 递增）；
 * - §7 line 741：幂等键 `${runCode}:${toolCallId}`，kind=artifact-register——重复登记必须撞唯一索引而不是多一行；
 * - §9.1 line 780：登记发生在"传完 doc.api 之后"，所以 fileCode/url 与状态同行走；
 * - §9.5 line 812：状态词表 = intake 一致性顺序（artifactReconcile 的 INTAKE_STATE，本文件与其有测试级对账）；
 * - §5 line 470：可见性 = 会话成员（conversationCode 是权限边界）；作者(userCode)只决定"谁改的"，
 *   跨人版本链每步都要能显示作者 ⇒ 每行自带 userCode，而非只在根上记。
 * 为什么单独一张表不塞 message.extInfo：产物要先于 message 引用存在（intake 登记在发 artifact_ready 之前），
 * 且对账要按"分配过哪些 fileCode/登记过哪些版本"扫描——那是表级查询，不是消息附件能承载的。
 */

import mongoose from 'mongoose'

const Schema = mongoose.Schema

/** 与 services/core/artifact/artifactReconcile 的 INTAKE_STATE 同词表（daos 层不 import services，防分层倒挂；测试里做集合相等断言防漂移） */
const INTAKE_STATES = ['started', 'pulled', 'uploaded', 'registered', 'ready', 'rolled-back', 'failed']

/** 完整性标记：对账执行器的持久化结论。默认 unknown——**没核验过不等于好**（孤儿判据同一纪律） */
const INTEGRITY_MARKS = ['unknown', 'ok', 'broken', 'dangling']

/**
 * @description 构造artifact的结构
 * @property {String} artifactCode 产物标识（唯一）
 * @property {String} conversationCode 会话标识（可见性边界 = 会话成员）
 * @property {String} channel 频道
 * @property {String} userCode 本版本作者（跨人版本链要逐行显示"谁改的"）
 * @property {String} runCode 产生它的 run
 * @property {String} toolCallId save_artifact 的调用标识
 * @property {String} idempotencyKey 幂等键 `${runCode}:${toolCallId}`（唯一；缺失由 sparse 索引豁免）
 * @property {String} name 文件名（plan.json / progress.md / 报告.pdf …）
 * @property {String} kind 类型：file|data 等（'data' 承载 plan 体系，见 §7）
 * @property {String} mimeType 内容类型
 * @property {Number} version lineage.version，同链递增
 * @property {String} parentArtifactCode 上一版本（空 = 链首）
 * @property {String} lineageRootArtifactCode 链根（拉整条版本历史用）
 * @property {String} fileCode doc.api 分配的文件标识；未上传为空串
 * @property {String} fileUrl doc.api 访问地址
 * @property {Number} sizeBytes 实测字节数（execd Range 契约校验过的，不是自报）
 * @property {String} sha256 内容指纹（核验/去重/对账的比对基准）
 * @property {String} sandboxId 来源沙箱
 * @property {String} sourcePath 沙箱内原始路径
 * @property {String} state intake 状态（INTAKE_STATE 词表）
 * @property {String} integrity 对账完整性标记（默认 unknown）
 * @property {String} messageCode 挂到哪条 message（被引用即受对账保护）
 * @property {Date} readyAt 进入 ready（发 artifact_ready）的时间
 * @property {Number} status 常规状态（-1 删除）
 * @property {Schema.Types.Mixed} operator 操作人
 * @property {Date} insertTime 创建时间
 * @property {Date} updateTime 最后更新时间
 * @author xianyang
 * @returns {Schema} schema 实例
 */
const artifactSchema = new Schema({
    artifactCode: {type: String, required: true, description: '产物标识（唯一）'},
    conversationCode: {type: String, default: '', description: '会话标识，可见性边界'},
    channel: {type: String, default: '', description: '频道标识'},
    userCode: {type: String, default: '', description: '本版本作者'},
    runCode: {type: String, default: '', description: '产生它的 run'},
    toolCallId: {type: String, default: '', description: 'save_artifact 调用标识'},
    /** 刻意无默认值：缺失的文档不进 sparse 唯一索引；写 '' 进来会让第二条无键登记撞墙——校验器禁空串 */
    idempotencyKey: {
        type: String,
        validate: {
            validator: (v) => v === undefined || (typeof v === 'string' && v.length > 0),
            message: 'idempotencyKey 要么不给，要么非空串（sparse 唯一索引的豁免语义依赖缺失，不依赖空值）',
        },
        description: '幂等键 ${runCode}:${toolCallId}',
    },
    name: {type: String, default: '', description: '文件名'},
    kind: {type: String, default: 'file', description: '类型：file|data 等'},
    mimeType: {type: String, default: '', description: '内容类型'},
    version: {type: Number, default: 1, description: '版本链内序号，递增'},
    parentArtifactCode: {type: String, default: '', description: '上一版本；空=链首'},
    lineageRootArtifactCode: {type: String, default: '', description: '链根，拉整条版本历史用'},
    fileCode: {type: String, default: '', description: 'doc.api 文件标识，未上传为空'},
    fileUrl: {type: String, default: '', description: 'doc.api 访问地址'},
    sizeBytes: {type: Number, default: 0, description: '实测字节数'},
    sha256: {type: String, default: '', description: '内容指纹'},
    sandboxId: {type: String, default: '', description: '来源沙箱'},
    sourcePath: {type: String, default: '', description: '沙箱内原始路径'},
    state: {type: String, enum: INTAKE_STATES, default: 'registered', description: 'intake 状态'},
    integrity: {type: String, enum: INTEGRITY_MARKS, default: 'unknown', description: '对账完整性标记，未核验=unknown'},
    messageCode: {type: String, default: '', description: '挂载消息；被引用受对账保护'},
    readyAt: {type: Date, default: null, description: '进入 ready 的时间'},
    status: {type: Number, default: 0, description: '常规状态（-1 删除）'},
    operator: {type: Schema.Types.Mixed, description: '操作人'},
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

/** 一行一版本：产物标识唯一 */
artifactSchema.index({artifactCode: 1}, {unique: true})
/** 幂等登记：同一 idempotencyKey 重放不许多行（缺失豁免，见字段注释） */
artifactSchema.index({idempotencyKey: 1}, {unique: true, sparse: true})
/** 会话内产物列表（可见性查询的主路径） */
artifactSchema.index({conversationCode: 1, insertTime: -1})
/** 版本链：按链根拉全history、按名找最新 */
artifactSchema.index({lineageRootArtifactCode: 1, version: 1})
artifactSchema.index({conversationCode: 1, name: 1, version: -1})
/** 对账扫描：在途（未终态）与按 fileCode 反查登记 */
artifactSchema.index({state: 1, insertTime: -1})
artifactSchema.index({fileCode: 1})

export default artifactSchema
