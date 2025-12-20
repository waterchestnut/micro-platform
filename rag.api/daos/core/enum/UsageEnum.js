/**
 * @fileOverview 知识库材料使用情况
 * @author xianyang
 * @module
 */
import Enumify from '../../../extends/Enumify.js'

export default class UsageEnum extends Enumify {
    static wait = new UsageEnum(0, '未使用')
    static used = new UsageEnum(1, '已使用')
    static waitText = new UsageEnum(2, '等待解析文本')
    static waitTrans = new UsageEnum(3, '等待翻译文本')
    static waitDocxText = new UsageEnum(4, 'DOCX等待解析文本')
    static waitDocxChunk = new UsageEnum(5, 'DOCX等待向量化处理')
    static error = new UsageEnum(-1, '文本提取出错，需要人员干预')
    static errorTrans = new UsageEnum(-2, '翻译切割等出错，需要人员干预')
    static errorOver = new UsageEnum(-3, '多次处理出错，人为标记，等待后续处理')
    static _ = this.closeEnum()
}