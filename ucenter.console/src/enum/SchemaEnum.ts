import BaseEnum, {Label, MXEnum} from './BaseEnum';

@MXEnum
export default class extends BaseEnum {
  @Label('默认使用模式')
  static default = 'default';
  @Label('存储信息，不做为系统登录账号')
  static store = 'store';
}

