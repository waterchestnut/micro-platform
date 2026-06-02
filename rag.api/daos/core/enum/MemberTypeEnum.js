/**
 * @fileOverview 成员类型
 * @author xianyang
 * @module
 */
import Enumify from '../../../extends/Enumify.js'

export default class MemberTypeEnum extends Enumify {
    static owner = new MemberTypeEnum('owner', '所有者')
    static admin = new MemberTypeEnum('admin', '管理员')
    static user = new MemberTypeEnum('user', '用户')
    static _ = this.closeEnum()
}