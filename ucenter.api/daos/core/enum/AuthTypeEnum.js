/**
 * @fileOverview 实体授权类型
 * @author xianyang 2024/5/28
 * @module
 */
import Enumify from '../../../extends/Enumify.js'

export default class AuthTypeEnum extends Enumify {
    static managed = new AuthTypeEnum(0, '管理添加的，可以删除')
    static builtIn = new AuthTypeEnum(1, '内置的，不允许删除')
    static trail = new AuthTypeEnum(2, '试用')
    static store = new AuthTypeEnum(3, '仅数据存储')
    static _ = this.closeEnum()
}