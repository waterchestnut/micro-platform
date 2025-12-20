/**
 * @fileOverview 平台类型
 * @author xianyang
 * @module
 */
import Enumify from '../../../extends/Enumify.js'

export default class PlatformTypeEnum extends Enumify {
    static xxzx = new PlatformTypeEnum('xxzx', '机构主平台')
    static union = new PlatformTypeEnum('union', '联盟资源平台')
    static _ = this.closeEnum()
}