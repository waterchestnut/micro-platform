/**
 * @fileOverview 材料处理的状态
 * @author xianyang 2025/7/15
 * @module
 */
import Enumify from '../../../extends/Enumify.js'

export default class HandleStatusEnum extends Enumify {
    static error = new HandleStatusEnum(-1, '处理出错')
    static wait = new HandleStatusEnum(0, '待处理')
    static handling = new HandleStatusEnum(1, '处理中')
    static success = new HandleStatusEnum(2, '处理完成')
    static _ = this.closeEnum()
}