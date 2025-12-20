/**
 * @fileOverview 授权模式
 * @author xianyang 2024/4/10
 * @module
 */
import Enumify from '../../../extends/Enumify.js'

export default class OAuthGrantTypeEnum extends Enumify {
    static code = new OAuthGrantTypeEnum('code', '授权码模式（authorization code）')
    static token = new OAuthGrantTypeEnum('token', '简化模式（implicit）')
    static password = new OAuthGrantTypeEnum('password', '密码模式（resource owner password credentials）')
    static clientCredentials = new OAuthGrantTypeEnum('clientCredentials', '客户端模式（client credentials）')
    static _ = this.closeEnum()
}