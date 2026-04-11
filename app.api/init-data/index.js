/**
 * @fileOverview 执行初始化数据
 * @author xianyang
 * @module
 */

import '../init.js'
import {addClient, updateClient} from '../services/core/client.js'
import {saveClientPageConfig} from '../services/core/clientPageConfig.js'

const tools = app.tools

let userInfo = {
    userCode: 'micro',
    realName: '超级管理员',
}

await addClient(userInfo, {
    clientCode: 'micro',
    clientName: '主平台',
    clientSecret: tools.getUUID(),
    retUrls: ['localhost:11001', 'micro.lc.jtxuexi.com'],
    needAuthProxy: false,
    order: 1
})

await addClient(userInfo, {
    clientCode: 'ucenter',
    clientName: '用户中心',
    clientSecret: tools.getUUID(),
    retUrls: ['localhost:11002', 'auth.lc.jtxuexi.com'],
    needAuthProxy: true,
    order: 2,
    upstreams: [{host: 'micro-ucenter-api-http:80', weight: 1}]
})

await saveClientPageConfig(userInfo, 'ucenter', [
    {
        'name': '验证码相关接口',
        'path': '/core/captcha*',
        'auth': false,
        'clientAuth': false,
        'privs': [],
        'clientPrivs': []
    },
    {
        'name': '获取用户列表',
        'path': '/core/user/list',
        'auth': true,
        'clientAuth': false,
        'privs': [
            'all'
        ],
        'clientPrivs': []
    },
    {
        'name': '获取当前登录用户信息',
        'path': '/core/user/cur*',
        'auth': true,
        'clientAuth': false,
        'privs': [
            'all'
        ],
        'clientPrivs': []
    },
    {
        'name': '登录相关接口',
        'path': '/core/user/auth/*',
        'auth': false,
        'clientAuth': false,
        'privs': [],
        'clientPrivs': []
    },
])

await addClient(userInfo, {
    clientCode: 'app',
    clientName: '应用管理',
    clientSecret: tools.getUUID(),
    retUrls: ['localhost:11003', 'app.lc.jtxuexi.com'],
    needAuthProxy: true,
    order: 3,
    upstreams: [{host: 'micro-app-api-http:80', weight: 1}]
})

console.log('done')