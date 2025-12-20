/**
 * @fileOverview 智能体执行方式
 * @author xianyang
 * @module
 */
import Enumify from '../../../extends/Enumify.js'

export default class AgentHandleModeEnum extends Enumify {
    static queue = new AgentHandleModeEnum('queue', '队列执行')
    static manual = new AgentHandleModeEnum('manual', '手动触发执行')
    static _ = this.closeEnum()
}