/**
 * @fileOverview 操作日志类型
 * @module
 */
import Enumify from '../../../extends/Enumify.js'

export default class LogTypeEnum extends Enumify {
    static member_join = new LogTypeEnum('member_join', '成员加入')
    static member_apply = new LogTypeEnum('member_apply', '成员申请')
    static application_approve = new LogTypeEnum('application_approve', '审批通过')
    static application_reject = new LogTypeEnum('application_reject', '审批拒绝')
    static material_add = new LogTypeEnum('material_add', '上传文档')
    static material_delete = new LogTypeEnum('material_delete', '删除文档')
    static member_quit = new LogTypeEnum('member_quit', '成员退出')
    static member_remove = new LogTypeEnum('member_remove', '成员被移除')
    static member_role_change = new LogTypeEnum('member_role_change', '成员身份变化')
    static _ = this.closeEnum()
}
