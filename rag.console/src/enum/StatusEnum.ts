import BaseEnum, {Label, MXEnum} from './BaseEnum';

@MXEnum
export default class extends BaseEnum {
  @Label('已删除')
  static deleted = -1;
  @Label('正常使用')
  static normal = 0;
  @Label('已禁用')
  static disabled = 1;
}

