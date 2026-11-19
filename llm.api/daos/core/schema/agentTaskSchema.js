/**
 * @fileOverview 智能体任务的结构
 * @author xianyang 2025/9/5
 * @module
 */

import mongoose from 'mongoose'
import StatusEnum from '../enum/StatusEnum.js'
import Tag from '../definition/Tag.js'
import AgentTypeEnum from '../enum/AgentTypeEnum.js'
import SubAgent from '../definition/SubAgent.js'
import AgentHandleStatusEnum from '../enum/AgentHandleStatusEnum.js'
import AgentErrorModeEnum from '../enum/AgentErrorModeEnum.js'
import AgentHandleModeEnum from '../enum/AgentHandleModeEnum.js'

const Schema = mongoose.Schema
const tools = llm.tools

/**
 * @description 定义agentTask的结构
 * @author xianyang
 * @property {String} agentCode 唯一标识
 * @property {String} title 智能体标题
 * @property {String} agentType 智能体类型：参见AgentTypeEnum
 * @property {String} parentCode 父级智能体标识
 * @property {String} nextAgentCode 下一个要执行的智能体标识，注意：只有串行的队列执行子任务需要此字段
 * @property {Schema.Types.Mixed[]} subAgents 子智能体，参见SubAgent
 * @property {String[]} agentCodePath 智能体标识路径，从顶层智能体到该智能体本身
 * @property {Number} handleStatus 执行状态：参见AgentHandleStatusEnum
 * @property {Schema.Types.Mixed} handleRet 执行返回值
 * @property {String} toParentOutputKey 向父级智能体传递执行结果的键值
 * @property {String} handler 智能体处理器
 * @property {Schema.Types.Mixed} params 初始参数
 * @property {String} params.grpcHost 远程任务调用的主机名
 * @property {String} params.llmModel 大模型任务的模型配置节点名称
 * @property {Object[]} params.llmMessages 大模型任务的输入消息列表
 * @property {Object} params.llmOriginalParams 大模型任务的自定义参数
 * @property {String} params.grpcHandler 远程执行的处理器
 * @property {String} params.dynamicTaskKey 动态创建任务的任务列表键值
 * @property {String} errorMode 处理错误的模式：参见AgentErrorModeEnum
 * @property {String} handleMode 执行模式：参见AgentHandleModeEnum
 * @property {Schema.Types.Mixed} operator 创建者
 * @property {Number} status 状态：参见StatusEnum
 * @property {Schema.Types.Mixed[]} tags 标签，参见Tag
 * @property {Date} insertTime 创建时间
 * @property {Date} updateTime 最近更新时间
 */
const agentTaskSchema = new Schema({
    agentCode: {
        type: String,
        default: function () {
            return tools.getUUID()
        },
        description: '智能体标识',
        required: true
    },
    title: {type: String, description: '智能体标题'},
    agentType: {type: String, default: 'local', description: '智能体类型', enum: AgentTypeEnum.toValues()},
    parentCode: {type: String, description: '父级智能体标识'},
    nextAgentCode: {type: String, description: '下一个要执行的智能体标识'},
    subAgents: {type: [SubAgent], description: '子智能体'},
    agentCodePath: {type: [String], description: '智能体标识路径'},
    handleStatus: {type: Number, default: 0, description: '执行状态', enum: AgentHandleStatusEnum.toValues()},
    handleRet: {type: Object, description: '执行返回值'},
    toParentOutputKey: {type: String, description: '向父级智能体传递执行结果的键值'},
    handler: {type: String, description: '智能体处理器'},
    params: {type: Object, description: '初始参数'},
    errorMode: {type: String, default: 'break', description: '处理错误的模式', enum: AgentErrorModeEnum.toValues()},
    handleMode: {type: String, default: 'queue', description: '执行模式', enum: AgentHandleModeEnum.toValues()},
    operator: {type: Object, description: '创建者'},
    status: {type: Number, default: 0, description: '状态', enum: StatusEnum.toValues()},
    tags: {type: [Tag], description: '标签'},
    /**
     * 会话任务编排（PR-任务编排）新增维度。刻意**不给默认值**：现有建课/并行/串行的 agentTask 不设这些，
     * 就应保持"字段缺席"而不是被平白写上一个值（shared 集合，加字段可以，塞默认值要克制）。
     * 声明在此只为：① 让 `bulkWrite` 的 cast 不再把它们当未知路径**静默丢弃**（这是 e2e 才能暴露的坑，
     * 离线用例里记录是普通对象、不经 schema，看不见）；② 建索引供 pump 按 `agentRole+handleStatus+insertTime` 取排队轮。
     */
    conversationCode: {type: String, description: '编排：所属会话（serialized-turn 跑用户原会话；child 为 agent: 隔离）'},
    rootCode: {type: String, description: '编排：所属 root 任务标识（self-root 时等于自身 agentCode，由接线方回填）'},
    agentRole: {type: String, description: '编排：节点角色 root/serialized-turn/child'},
    /**
     * 编排 root 的**显式声明**：只有带 `orchestrated:true` 的行才允许 finalize 触发（B1）。
     * 不给默认值——建课等存量行没有它 ⇒ `shouldTriggerFinalize` 的 orchestrated 侧恒 false，
     * 这是"哪怕总开关被误开，老任务也绝不进编排收尾"的第二道闸。
     */
    orchestrated: {type: Boolean, description: '编排：root 是否声明需要 finalize 收尾'},
    budgetUsedTokens: {type: Number, description: '编排：root 累计 token 预算占用'},
    retryCount: {type: Number, description: '编排：已重试次数（与 recover 的 tags.recoverCount 不同轴）'},
    /** 追活(f)：已 replan 换代数。finalize 写回，与 retryCount 同由 follow 循环维护——单写者=root finalize */
    replanCount: {type: Number, description: '编排：已 replan 换代次数'},
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
agentTaskSchema.index({insertTime: 1})
agentTaskSchema.index({updateTime: 1})
agentTaskSchema.index({agentCode: 1})
agentTaskSchema.index({agentCodePath: 1})
agentTaskSchema.index({'operator.userCode': 1})
agentTaskSchema.index({'tags.key': 1})
agentTaskSchema.index({'tags.value': 1})
/** 编排 pump：取某会话最旧的待执行追问轮（agentRole+handleStatus 过滤，insertTime 升序取队首） */
agentTaskSchema.index({agentRole: 1, handleStatus: 1, insertTime: 1})
agentTaskSchema.index({conversationCode: 1, handleStatus: 1})
/**
 * 幂等键（§5-1）两道 **partial unique**——DB 级兜"预查通过后两请求并发都来插"的窗口，
 * 应用层先查只是省一次插入/一次模型调用，唯一性裁决权在库：
 * - serialized-turn：同会话同一 messageCode 的**等待中**行至多一条（执行后 partialFilter 解除，
 *   同码失败重推是合法动作，不永久锁死）；
 * - 编排 root：同会话同一 idemKey **永久至多一条**（受理键一次性，duplicate 请求永远指回原树）。
 * ⚠️ partialFilterExpression 的字段必须等值（这里 agentRole/handleStatus/orchestrated 都是等值）；
 * 存量集合上 autoIndex 建索引若因**历史重复数据**失败只会打日志——探针要实证 index 真在（见 handoff §7）。
 */
agentTaskSchema.index({conversationCode: 1, 'params.messageCode': 1}, {
    unique: true,
    partialFilterExpression: {agentRole: 'serialized-turn', handleStatus: 0},
    name: 'uniq_serializedTurn_messageCode',
})
agentTaskSchema.index({conversationCode: 1, 'params.idemKey': 1}, {
    unique: true,
    partialFilterExpression: {agentRole: 'root', orchestrated: true},
    name: 'uniq_orchestratedRoot_idemKey',
})

export default agentTaskSchema