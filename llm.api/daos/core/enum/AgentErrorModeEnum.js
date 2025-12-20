/**
 * @fileOverview 智能体执行出错的处理方式
 * @author xianyang
 * @module
 */
import Enumify from '../../../extends/Enumify.js'

export default class AgentErrorModeEnum extends Enumify {
    static break = new AgentErrorModeEnum('break', '中断退出')
    static continue = new AgentErrorModeEnum('continue', '不影响整体流程，继续执行')
    static _ = this.closeEnum()
}