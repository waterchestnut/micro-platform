/**
 * @fileOverview 记忆实体的生命周期状态
 * @module daos/core/enum/MemoryStatusEnum
 * @description 与 StatusEnum 分工不同：StatusEnum 表达软删除（由 BaseDac 隐式过滤 status: -1），
 * 本枚举表达记忆自身的生命周期。刻意使用独立字段 state 承载，避免退役、待审的记录被软删过滤掉而断掉证据链。
 */
import Enumify from '../../../extends/Enumify.js'

export default class MemoryStatusEnum extends Enumify {
    static active = new MemoryStatusEnum('active', '生效中')
    static review = new MemoryStatusEnum('review', '待人工确认')
    static superseded = new MemoryStatusEnum('superseded', '已被替代')
    static retired = new MemoryStatusEnum('retired', '已退役')
    static _ = this.closeEnum()
}
