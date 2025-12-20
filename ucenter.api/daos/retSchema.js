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
    'FAIL_OAUTH_CLIENTCODE_MISS': {code: 1001, msg: '缺少应用标识'},
    'FAIL_OAUTH_RETURL_MISS': {code: 1002, msg: '缺少回调地址'},
    'FAIL_OAUTH_CLIENT_MISS': {code: 1003, msg: '应用不存在'},
    'FAIL_OAUTH_CLIENT_DISABLED': {code: 1004, msg: '应用已禁用'},
    'FAIL_OAUTH_RETURL_ERROR': {code: 1005, msg: '回调地址错误'},
    'FAIL_OAUTH_CLIENTSECRET_MISS': {code: 1006, msg: '缺少应用秘钥'},
    'FAIL_OAUTH_CLIENTSECRET_INVALID': {code: 1007, msg: '应用秘钥无效'},
    'FAIL_OAUTH_AUTHCODE_MISS': {code: 1008, msg: '缺少授权码'},
    'FAIL_OAUTH_AUTHCODE_INVALID': {code: 1009, msg: '授权码无效'},

    'FAIL_SMS_SEND_OFTEN': {code: 2001, msg: '验证码发送过于频繁'},
    'FAIL_SMS_AUTH_INVALID': {code: 2002, msg: '手机验证码错误'},

    'FAIL_MOBILE_HAS_BIND': {code: 3001, msg: '手机号已存在'},
    'FAIL_MOBILE_NOT_BIND': {code: 3002, msg: '手机号码未绑定账号'},
    'FAIL_MOBILE_BIND': {code: 3003, msg: '手机号码绑定失败'},

    'FAIL_TOKEN_MISS': {code: 4001, msg: '缺少token'},
    'FAIL_TOKEN_INVALID': {code: 4002, msg: 'token无效'},
    'FAIL_TOKEN_NO_REDIRECT': {code: 4003, msg: 'token无效'},

    'FAIL_ORG_NOT_EXIST': {code: 5001, msg: '机构不存在'},
    'FAIL_ORG_DISABLED': {code: 5002, msg: '机构已禁用'},

    'FAIL_USER_NOAUTHORITY': {code: 6000, msg: '没有进行此项操作的权限'},
    'FAIL_USER_VCODE_MISS': {code: 6001, msg: '缺少验证码'},
    'FAIL_USER_VCODE_INVALID': {code: 6002, msg: '验证码错误'},
    'FAIL_USER_LOGIN_ERROR': {code: 6003, msg: '用户登录出错'},
    'FAIL_USER_ERRORNAMEORPWD': {code: 6004, msg: '账号或密码错误，您已输错n次，连续累计输错5次将锁定半小时。可以点击忘记密码，通过手机号和验证码找回密码。'},
    'FAIL_USER_EXPIRE': {code: 6005, msg: '用户已过期'},
    'FAIL_USER_DISABLE': {code: 6006, msg: '该账号被禁止登录'},
    'FAIL_USER_NOT_EXIST': {code: 6007, msg: '该账号不存在，请先注册'},
    'FAIL_USER_LOCK': {code: 6008, msg: '账号或密码错误，您已连续累计输错5次，将锁定半小时。可以点击忘记密码，通过手机号和验证码找回密码。'},
    'FAIL_USER_DUPLICATE_USERCODE': {code: 6009, msg: '输入数据用户标识重复'},
    'FAIL_USER_DUPLICATE_MOBILE': {code: 6010, msg: '输入数据手机号重复'},
    'FAIL_USER_DUPLICATE_EMAIL': {code: 6011, msg: '输入数据邮箱重复'},
    'FAIL_USER_HASEXIST_USERCODE': {code: 6012, msg: '数据库中用户标识已经存在'},
    'FAIL_USER_HASEXIST_MOBILE': {code: 6013, msg: '数据库中手机号已经存在'},
    'FAIL_USER_HASEXIST_EMAIL': {code: 6014, msg: '数据库中邮箱已经存在'},
    'FAIL_USER_DELETE_ERROR': {code: 6015, msg: '用户删除失败'},
    'FAIL_USER_NOT_USERCODE': {code: 6016, msg: '缺少用户标识'},
    
    'FAIL_USER_MOBILE_HAS_BIND': {code: 6025, msg: '手机号已存在'},
    'FAIL_USER_MOBILE_NOT_BIND': {code: 6026, msg: '手机号码未绑定账号'},
    'FAIL_USER_MOBILE_BIND': {code:6027, msg: '手机号码绑定失败'},
    'FAIL_MAIL_AUTH_INVALID': {code: 6028, msg: '邮箱验证码错误'},
    'FAIL_USER_EMAIL_HAS_BIND': {code: 6029, msg: '邮箱已存在'},
    'FAIL_USER_EMAIL_NOT_BIND': {code: 6030, msg: '邮箱未绑定账号'},
    'FAIL_USER_EMAIL_BIND': {code:6031, msg: '邮箱绑定失败'}
}
