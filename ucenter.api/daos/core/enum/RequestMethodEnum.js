/**
 * @fileOverview 请求类型
 * @author xianyang
 * @module
 */
import Enumify from '../../../extends/Enumify.js'

export default class RequestMethodEnum extends Enumify {
    static GET = new RequestMethodEnum('GET', 'GET')
    static POST = new RequestMethodEnum('POST', 'POST')
    static PUT = new RequestMethodEnum('PUT', 'PUT')
    static DELETE = new RequestMethodEnum('DELETE', 'DELETE')
    static PATCH = new RequestMethodEnum('PATCH', 'PATCH')
    static HEAD = new RequestMethodEnum('HEAD', 'HEAD')
    static OPTIONS = new RequestMethodEnum('OPTIONS', 'OPTIONS')
    static CONNECT = new RequestMethodEnum('CONNECT', 'CONNECT')
    static TRACE = new RequestMethodEnum('TRACE', 'TRACE')
    static _ = this.closeEnum()
}