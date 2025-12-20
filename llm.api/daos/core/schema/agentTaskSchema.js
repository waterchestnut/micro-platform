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

export default agentTaskSchema