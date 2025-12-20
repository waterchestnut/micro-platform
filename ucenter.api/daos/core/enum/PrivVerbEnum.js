/**
 * @fileOverview 权限动作
 * @author xianyang 2024/5/31
 * @module
 */
import Enumify from '../../../extends/Enumify.js'

export default class PrivVerbEnum extends Enumify {
    static browse = new PrivVerbEnum('browse', '浏览')
    static get = new PrivVerbEnum('get', '详情')
    static list = new PrivVerbEnum('list', '列表')
    static create = new PrivVerbEnum('create', '添加')
    static update = new PrivVerbEnum('update', '修改')
    static delete = new PrivVerbEnum('delete', '删除')
    static _ = this.closeEnum()
}