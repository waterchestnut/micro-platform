import BaseEnum, {Label, MXEnum} from './BaseEnum';

@MXEnum
export default class extends BaseEnum {
  @Label('其他')
  static other = 'other';
  @Label('学校')
  static school = 'school';
  @Label('仲裁机构')
  static arbitration = 'arbitration';
  @Label('法院')
  static court = 'court';
  @Label('法人或其他组织')
  static legal = 'legal';
}

