/**
 * @fileOverview 会话消息的进度
 * @author xianyang
 * @module
 */
import Enumify from '../../../extends/Enumify.js'

export default class MessageProgressEnum extends Enumify {
    static waiting = new MessageProgressEnum('waiting', '待处理')
    static processing = new MessageProgressEnum('processing', '处理中')
    static finish = new MessageProgressEnum('finish', '完成')
    static error = new MessageProgressEnum('error', '出错')
    static abort = new MessageProgressEnum('abort', '取消')
    static _ = this.closeEnum()
}