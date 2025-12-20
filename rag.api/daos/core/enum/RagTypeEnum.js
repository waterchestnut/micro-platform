/**
 * @fileOverview 知识库类型
 * @author xianyang
 * @module
 */
import Enumify from '../../../extends/Enumify.js'

export default class RagTypeEnum extends Enumify {
    static builtIn = new RagTypeEnum('builtIn', '内置的知识库')
    static dify = new RagTypeEnum('dify', 'dify平台的知识库')
    static self = new RagTypeEnum('self', '自建的知识库')
    static _ = this.closeEnum()
}