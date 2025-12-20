/**
 * @fileOverview 访问端类型
 * @author xianyang
 * @module
 */
import Enumify from '../../../extends/Enumify.js'

export default class EndpointTypeEnum extends Enumify {
    static pc = new EndpointTypeEnum('pc', 'PC微前端访问')
    static pcIframe = new EndpointTypeEnum('pcIframe', 'PC端Iframe访问')
    static miniNative = new EndpointTypeEnum('miniNative', '小程序原生访问')
    static miniH5 = new EndpointTypeEnum('miniH5', '小程序H5访问')
    static _ = this.closeEnum()
}