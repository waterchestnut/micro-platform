import BaseEnum, {Label, MXEnum} from './BaseEnum';

@MXEnum
export default class extends BaseEnum {
  @Label('未定义')
  static notSet = 0;
  @Label('男性')
  static male = 1;
  @Label('女性')
  static female = 2;
}

