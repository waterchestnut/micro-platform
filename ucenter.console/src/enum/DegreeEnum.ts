import BaseEnum, {Label, MXEnum} from './BaseEnum';

@MXEnum
export default class extends BaseEnum {
  @Label('未设置')
  static notSet = 0;
  @Label('专科')
  static professional = 1;
  @Label('本科')
  static undergraduate = 2;
  @Label('硕士')
  static master = 3;
  @Label('博士')
  static doctor = 4;
}

