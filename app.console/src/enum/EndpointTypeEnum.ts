import BaseEnum, {Label, MXEnum} from './BaseEnum'

@MXEnum
export default class extends BaseEnum {
  @Label('PC微前端访问')
  static pc = 'pc'
  @Label('PC端Iframe访问')
  static pcIframe = 'pcIframe'
  @Label('小程序原生访问')
  static miniNative = 'miniNative'
  @Label('小程序H5访问')
  static miniH5 = 'miniH5'
}
