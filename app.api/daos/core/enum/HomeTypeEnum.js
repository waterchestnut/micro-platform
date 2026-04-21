/**
 * @fileOverview 在首页排布的类型
 * @author xianyang
 * @module
 */
import Enumify from '../../../extends/Enumify.js'

export default class HomeTypeEnum extends Enumify {
    static remove = new HomeTypeEnum(-1, '从首页移除')
    static add = new HomeTypeEnum(1, '添加到首页')
    static _ = this.closeEnum()
}