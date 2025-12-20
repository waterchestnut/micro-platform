/**
 * @fileOverview 会话消息的进度
 * @author xianyang
 * @module
 */
import Enumify from '../../../extends/Enumify.js'

export default class MessageProgressEnum extends Enumify {
    static waiting = new MessageProgressEnum('waiting', '等待发送')
    static processing = new MessageProgressEnum('processing', '思考处理中')
    static finish = new MessageProgressEnum('finish', '回答完成')
    static error = new MessageProgressEnum('error', '回答出错')
    static _ = this.closeEnum()
}