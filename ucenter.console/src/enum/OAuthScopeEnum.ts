import BaseEnum, {Label, MXEnum} from './BaseEnum';

@MXEnum
export default class extends BaseEnum {
  @Label('读取个人用户的基本信息')
  static myRead = 'myRead';
  @Label('修改个人基本信息')
  static myWrite = 'myWrite';
  @Label('管理员的后台管理等功能')
  static admin = 'admin';
}

