import BaseEnum, {Label, MXEnum} from './BaseEnum';

@MXEnum
export default class LogTypeEnum extends BaseEnum {
  @Label('成员加入')
  static member_join = 'member_join';
  @Label('成员申请')
  static member_apply = 'member_apply';
  @Label('审批通过')
  static application_approve = 'application_approve';
  @Label('审批拒绝')
  static application_reject = 'application_reject';
  @Label('上传文档')
  static material_add = 'material_add';
  @Label('删除文档')
  static material_delete = 'material_delete';
  @Label('成员退出')
  static member_quit = 'member_quit';
  @Label('成员被移除')
  static member_remove = 'member_remove';
  @Label('成员身份变化')
  static member_role_change = 'member_role_change';
}
