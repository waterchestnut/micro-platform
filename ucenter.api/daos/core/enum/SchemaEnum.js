/**
 * @fileOverview 使用模式
 * @author xianyang 2024/5/31
 * @module
 */
import Enumify from '../../../extends/Enumify.js'

export default class SchemaEnum extends Enumify {
    static default = new SchemaEnum('default', '默认使用模式')
    static store = new SchemaEnum('store', '存储信息，不做为系统登录账号')
    static _ = this.closeEnum()
}