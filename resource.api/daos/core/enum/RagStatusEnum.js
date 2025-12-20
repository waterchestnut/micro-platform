/**
 * @fileOverview 资源RAG的状态
 * @author xianyang
 * @module
 */
import Enumify from '../../../extends/Enumify.js'

export default class RagStatusEnum extends Enumify {
    static error = new RagStatusEnum(-1, '处理出错')
    static wait = new RagStatusEnum(0, '待处理')
    static handling = new RagStatusEnum(1, '处理中')
    static success = new RagStatusEnum(2, '处理完成')
    static _ = this.closeEnum()
}