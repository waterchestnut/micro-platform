/**
 * @fileOverview 学位
 * @author xianyang 2024/5/19
 * @module
 */
import Enumify from '../../../extends/Enumify.js'

export default class DegreeEnum extends Enumify {
    static notSet = new DegreeEnum(0, '未设置')
    static professional = new DegreeEnum(1, '专科')
    static undergraduate = new DegreeEnum(2, '本科')
    static master = new DegreeEnum(3, '硕士')
    static doctor = new DegreeEnum(4, '博士')
    static _ = this.closeEnum()
}