/**
 * @fileOverview 文件存储类型
 * @author xianyang
 * @module
 */
import Enumify from '../../../extends/Enumify.js'

export default class StoreTypeEnum extends Enumify {
    static random = new StoreTypeEnum('random', '自由分配存储位置')
    static unique = new StoreTypeEnum('unique', '只保留一份物理文件')
    static _ = this.closeEnum()
}