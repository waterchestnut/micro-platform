import BaseEnum, {Label, MXEnum} from './BaseEnum';

@MXEnum
export default class extends BaseEnum {
  @Label('登录用户认证')
  static user = 0;
  @Label('第三方客户端认证')
  static client = 1;
  @Label('第三方客户端发起的用户认证')
  static clientUser = 2;
}

