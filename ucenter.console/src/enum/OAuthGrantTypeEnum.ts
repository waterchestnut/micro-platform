import BaseEnum, {Label, MXEnum} from './BaseEnum';

@MXEnum
export default class extends BaseEnum {
  @Label('授权码模式（authorization code）')
  static code = 'code';
  @Label('简化模式（implicit）')
  static token = 'token';
  @Label('密码模式（resource owner password credentials）')
  static password = 'password';
  @Label('客户端模式（client credentials）')
  static clientCredentials = 'clientCredentials';
}

