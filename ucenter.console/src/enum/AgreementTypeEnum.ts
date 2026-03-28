import BaseEnum, {Label, MXEnum} from './BaseEnum'

@MXEnum
export default class extends BaseEnum {
  @Label('用户协议')
  static user = 1
  @Label('隐私协议')
  static privacy = 2
}

