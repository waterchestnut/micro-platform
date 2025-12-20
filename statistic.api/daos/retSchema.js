/**
 * @fileOverview 定义接口返回的code和msg
 * @author xianyang 2024/5/13
 * @module daos/retSchema
 * @description
 */

export default {
    'SUCCESS': {code: 0, msg: '成功'},
    'FAIL_PARAM_MISS': {code: 1, msg: '参数不全'},
    'FAIL_UNEXPECTED': {code: -99, msg: '未知错误'},

    'FAIL_OAUTH_PARAM_MISS': {code: 1000, msg: '参数不全'},
}
