import BaseEnum, {Label, MXEnum} from './BaseEnum';

@MXEnum
export default class MemberTypeEnum extends BaseEnum {
  @Label('创建者')
  static owner = 'owner';
  @Label('管理员')
  static admin = 'admin';
  @Label('用户')
  static user = 'user';
}
