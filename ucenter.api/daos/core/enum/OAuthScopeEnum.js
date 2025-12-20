/**
 * @fileOverview 授权范围
 * @author xianyang 2024/4/10
 * @module
 */
import Enumify from '../../../extends/Enumify.js'

export default class OAuthScopeEnum extends Enumify {
    static myRead = new OAuthScopeEnum('myRead', '读取个人用户的基本信息')
    static myWrite = new OAuthScopeEnum('myWrite', '修改个人基本信息')
    static admin = new OAuthScopeEnum('admin', '管理员的后台管理等功能')
    static _ = this.closeEnum()
}