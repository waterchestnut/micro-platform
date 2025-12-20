/**
 * @fileOverview 成员类型
 * @author xianyang
 * @module
 */
import Enumify from '../../../extends/Enumify.js'

export default class MemberTypeEnum extends Enumify {
    static owner = new MemberTypeEnum('owner', '所有者')
    static read = new MemberTypeEnum('read', '召回')
    static write = new MemberTypeEnum('write', '召回与编辑')
    static _ = this.closeEnum()
}