/**
 * @fileOverview 智能体任务执行状态
 * @author xianyang
 * @module
 */
import Enumify from '../../../extends/Enumify.js'

export default class AgentHandleStatusEnum extends Enumify {
    static error = new AgentHandleStatusEnum(-1, '执行出错')
    static waiting = new AgentHandleStatusEnum(0, '等待执行')
    static handling = new AgentHandleStatusEnum(1, '执行中')
    static success = new AgentHandleStatusEnum(2, '执行成功')
    static completed = new AgentHandleStatusEnum(3, '执行完成，部分出错')
    static _ = this.closeEnum()
}