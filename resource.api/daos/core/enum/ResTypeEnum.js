/**
 * @fileOverview 资源类型
 * @author xianyang 2024/5/28
 * @module
 */
import Enumify from '../../../extends/Enumify.js'

export default class ResTypeEnum extends Enumify {
    static book = new ResTypeEnum('book', '图书')
    static thesis = new ResTypeEnum('thesis', '论文')
    static journal = new ResTypeEnum('journal', '期刊')
    static dataset = new ResTypeEnum('dataset', '数据')
    static video = new ResTypeEnum('video', '视频')
    static patent = new ResTypeEnum('patent', '专利')
    static audio = new ResTypeEnum('audio', '音频')
    static image = new ResTypeEnum('image', '图片')
    static standard = new ResTypeEnum('standard', '标准')
    static article = new ResTypeEnum('article', '文章')
    static exercise = new ResTypeEnum('exercise', '试题')
    static meeting = new ResTypeEnum('meeting', '会议')
    static upload = new ResTypeEnum('upload', '自定义上传')
    static _ = this.closeEnum()
}