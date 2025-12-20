import BaseEnum, {Label, MXEnum} from './BaseEnum'

@MXEnum
export default class extends BaseEnum {
  @Label('机构主平台')
  static xxzx = 'xxzx'
  @Label('存储信息，联盟资源平台')
  static union = 'union'
}
