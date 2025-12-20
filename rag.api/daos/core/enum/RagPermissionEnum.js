/**
 * @fileOverview 知识库权限类型
 * @author xianyang
 * @module
 */
import Enumify from '../../../extends/Enumify.js'

export default class RagPermissionEnum extends Enumify {
    static union = new RagPermissionEnum('union', '联盟平台内共享')
    static member = new RagPermissionEnum('member', '仅知识库成员可用')
    static platform = new RagPermissionEnum('platform', '机构平台内共享')
    static departmentDirect = new RagPermissionEnum('departmentDirect', '直属部门成员可用')
    static departmentALL = new RagPermissionEnum('departmentALL', '部门及下属部门成员可用')
    static _ = this.closeEnum()
}