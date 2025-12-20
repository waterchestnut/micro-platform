/**
 * @fileOverview 文件来源
 * @author xianyang
 * @module
 */
import Enumify from '../../../extends/Enumify.js'

export default class SourceTypeEnum extends Enumify {
    static upload = new SourceTypeEnum('upload', '直接上传')
    static convert = new SourceTypeEnum('convert', '系统转换')
    static copy = new SourceTypeEnum('copy', '文件复制')
    static link = new SourceTypeEnum('link', '链接下载')
    static _ = this.closeEnum()
}