/**
 * @fileOverview 首页排布访问端
 * @author xianyang
 * @module
 */
import Enumify from '../../../extends/Enumify.js'

export default class HomeEndpointEnum extends Enumify {
    static pc = new HomeEndpointEnum('pc', 'PC端')
    static mobile = new HomeEndpointEnum('mobile', '移动端')
    static _ = this.closeEnum()
}