/**
 * @fileOverview 性别
 * @author xianyang 2024/5/19
 * @module
 */
import Enumify from '../../../extends/Enumify.js'

export default class GenderEnum extends Enumify {
    static notSet = new GenderEnum(0, '未定义')
    static male = new GenderEnum(1, '男性')
    static female = new GenderEnum(2, '女性')
    static _ = this.closeEnum()
}