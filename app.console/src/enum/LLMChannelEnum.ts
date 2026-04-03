import BaseEnum, {Label, MXEnum} from './BaseEnum'

@MXEnum
export default class extends BaseEnum {
  @Label('通用助手')
  static micro_common = 'micro_common'
  @Label('文献助手')
  static pdfviewer_literature = 'pdfviewer_literature'
  @Label('编程助手')
  static code_assistant = 'code_assistant'
}
