/**
 * @fileOverview 会话的类型
 * @author xianyang
 * @module
 */
import Enumify from '../../../extends/Enumify.js'

export default class ConversationTypeEnum extends Enumify {
    static chat = new ConversationTypeEnum('chat', '大模型对话')
    static agentTask = new ConversationTypeEnum('agentTask', '智能体任务')
    static _ = this.closeEnum()
}