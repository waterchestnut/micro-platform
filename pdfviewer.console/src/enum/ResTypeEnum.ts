import BaseEnum, {Label, MXEnum} from './BaseEnum'

@MXEnum
export default class extends BaseEnum {
  @Label('图书')
  static book = 'book'
  @Label('论文')
  static thesis = 'thesis'
  @Label('期刊')
  static journal = 'journal'
  @Label('数据')
  static dataset = 'dataset'
  @Label('视频')
  static video = 'video'
  @Label('专利')
  static patent = 'patent'
  @Label('音频')
  static audio = 'audio'
  @Label('图片')
  static image = 'image'
  @Label('标准')
  static standard = 'standard'
  @Label('文章')
  static article = 'article'
  @Label('试题')
  static exercise = 'exercise'
  @Label('会议')
  static meeting = 'meeting'
  @Label('自定义上传')
  static upload = 'upload'
}
