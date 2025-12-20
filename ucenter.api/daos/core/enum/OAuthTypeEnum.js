/**
 * @fileOverview OAuth认证类型
 * @author xianyang 2024/4/11
 * @module
 */
import Enumify from '../../../extends/Enumify.js'

export default class OAuthTypeEnum extends Enumify {
    static user = new OAuthTypeEnum(0, '登录用户认证')
    static client = new OAuthTypeEnum(1, '第三方客户端认证')
    static clientUser = new OAuthTypeEnum(2, '第三方客户端发起的用户认证')
    static _ = this.closeEnum()
}