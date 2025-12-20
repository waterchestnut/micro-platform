import BaseEnum, {Label, MXEnum} from './BaseEnum'

@MXEnum
export default class extends BaseEnum {
  @Label('平台内置的应用')
  static builtIn = 'builtIn'
  @Label('官方维护的应用')
  static official = 'official'
  @Label('第三方维护的应用')
  static thirdParty = 'thirdParty'
  @Label('机构自建的应用')
  static selfBuild = 'selfBuild'
  @Label('社区开源的应用')
  static community = 'community'
}
