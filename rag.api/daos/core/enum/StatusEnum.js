/**
 * @fileOverview 实体状态
 * @author xianyang 2024/5/28
 * @module
 */
import Enumify from '../../../extends/Enumify.js'

export default class StatusEnum extends Enumify {
    static deleted = new StatusEnum(-1, '已删除')
    static normal = new StatusEnum(0, '正常使用')
    static disabled = new StatusEnum(1, '已禁用')
    static _ = this.closeEnum()
}