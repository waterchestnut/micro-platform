import BaseEnum, {Label, MXEnum} from './BaseEnum';

@MXEnum
export default class extends BaseEnum {
  @Label('管理添加的，可以删除')
  static managed = 0;
  @Label('内置的，不允许删除')
  static builtIn = 1;
  @Label('试用')
  static trail = 2;
  @Label('仅数据存储')
  static store = 3;
}

