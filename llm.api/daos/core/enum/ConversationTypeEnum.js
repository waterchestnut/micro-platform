/**
 * @fileOverview 会话的类型
 * @author xianyang
 * @module
 */
import Enumify from '../../../extends/Enumify.js'

export default class ConversationTypeEnum extends Enumify {
    static chat = new ConversationTypeEnum('chat', '大模型对话')
    static agentTask = new ConversationTypeEnum('agentTask', '智能体任务')
    static u2u = new ConversationTypeEnum('u2u', '单一用户对用户聊天')
    static m2m = new ConversationTypeEnum('m2m', '多对多用户聊天')
    static _ = this.closeEnum()
}