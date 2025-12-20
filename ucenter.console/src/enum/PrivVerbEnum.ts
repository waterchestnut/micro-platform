import BaseEnum, {Label, MXEnum} from './BaseEnum';

@MXEnum
export default class extends BaseEnum {
  @Label('浏览')
  static browse = 'browse';
  @Label('详情')
  static get = 'get';
  @Label('列表')
  static list = 'list';
  @Label('添加')
  static create = 'create';
  @Label('修改')
  static update = 'update';
  @Label('删除')
  static delete = 'delete';
}

