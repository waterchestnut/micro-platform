/**
 * @fileOverview 智能体的类型
 * @author xianyang
 * @module
 */
import Enumify from '../../../extends/Enumify.js'

export default class AgentTypeEnum extends Enumify {
    static sequential = new AgentTypeEnum('sequential', '串行')
    static parallel = new AgentTypeEnum('parallel', '并行')
    static dynamic = new AgentTypeEnum('dynamic', '动态任务')
    static local = new AgentTypeEnum('local', '本地原子任务')
    static grpc = new AgentTypeEnum('grpc', '远程原子任务')
    static llm = new AgentTypeEnum('llm', '大模型调用原子任务')
    static _ = this.closeEnum()
}