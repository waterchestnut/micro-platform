/**
 * @fileOverview 执行初始化数据
 * @author xianyang
 * @module
 */

import '../init.js'
import {addClient, updateClient} from '../services/core/client.js'
import {saveClientPageConfig} from '../services/core/clientPageConfig.js'
import {addPriv} from '../grpc/clients/priv.js'

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
    upstreams: [{host: 'micro-ucenter-api-http:80', weight: 1}],
    endpoints: [{
        'endpointType': 'pc',
        'visitPath': 'https://auth.lc.jtxuexi.com',
        'status': 0,
    }]
})

await saveClientPageConfig(userInfo, 'ucenter', [
    {
        'name': '公开接口',
        'path': '/public-bin/*',
        'auth': false,
        'clientAuth': false,
        'privs': [],
        'clientPrivs': []
    },
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
    upstreams: [{host: 'micro-app-api-http:80', weight: 1}],
    endpoints: [{
        'endpointType': 'pc',
        'visitPath': 'https://app.lc.jtxuexi.com',
        'status': 0,
    }]
})

await addClient(userInfo, {
    clientCode: 'doc',
    clientName: '文档管理',
    clientSecret: tools.getUUID(),
    retUrls: ['localhost:11004', 'doc.lc.jtxuexi.com'],
    needAuthProxy: true,
    order: 4,
    upstreams: [{host: 'micro-doc-api-http:80', weight: 1}],
})

await saveClientPageConfig(userInfo, 'doc', [
    {
        'name': '公开接口',
        'path': '/public-bin/*',
        'auth': false,
        'clientAuth': false,
        'privs': [],
        'clientPrivs': []
    },
    {
        'name': '文件上传',
        'path': '/file/upload/!*',
        'auth': true,
        'clientAuth': false,
        'privs': [
            'all'
        ],
        'clientPrivs': []
    },
    {
        'name': '文件下载',
        'path': '/file/download/!*',
        'auth': false,
        'clientAuth': false,
        'privs': [],
        'clientPrivs': []
    }
])

await addClient(userInfo, {
    clientCode: 'llm',
    clientName: '大模型网关',
    clientSecret: tools.getUUID(),
    retUrls: ['localhost:11008', 'llm.lc.jtxuexi.com'],
    needAuthProxy: true,
    order: 5,
    upstreams: [{host: 'micro-llm-api-http:80', weight: 1}],
})

await addClient(userInfo, {
    clientCode: 'pdfviewer',
    clientName: '文献解读器',
    clientSecret: tools.getUUID(),
    retUrls: ['localhost:11016', 'pdfviewer.lc.jtxuexi.com'],
    needAuthProxy: true,
    order: 6,
    endpoints: [{
        'endpointType': 'pc',
        'visitPath': 'https://pdfviewer.lc.jtxuexi.com',
        'status': 0,
    }]
})

await addClient(userInfo, {
    clientCode: 'rag',
    clientName: '知识库',
    clientSecret: tools.getUUID(),
    retUrls: ['localhost:11013', 'rag.lc.jtxuexi.com'],
    needAuthProxy: true,
    order: 7,
    upstreams: [{host: 'micro-rag-api-http:80', weight: 1}],
    endpoints: [{
        'endpointType': 'pc',
        'visitPath': 'https://rag.lc.jtxuexi.com',
        'status': 0,
    }]
})

await addClient(userInfo, {
    clientCode: 'resource',
    clientName: '资源服务',
    clientSecret: tools.getUUID(),
    retUrls: ['localhost:11007', 'resource.lc.jtxuexi.com'],
    needAuthProxy: true,
    order: 8,
    upstreams: [{host: 'micro-resource-api-http:80', weight: 1}],
})

await addPriv(userInfo, {
    modulePrivCode: 'resource-ipmi',
    modulePrivName: '资源管理',
    clientCode: 'resource',
    moduleCode: 'resource-main',
    privVerb: 'browse'
})

await saveClientPageConfig(userInfo, 'resource', [
    {
        'name': '公开接口',
        'path': '/public-bin/*',
        'auth': false,
        'clientAuth': false,
        'privs': [],
        'clientPrivs': []
    },
    {
        'name': '资源管理',
        'path': '/core/res-info/ipmi/*',
        'auth': true,
        'clientAuth': false,
        'privs': [
            'resource-ipmi'
        ],
        'clientPrivs': []
    },
    {
        'name': '通用资源服务',
        'path': '/core/*',
        'auth': true,
        'clientAuth': false,
        'privs': [
            'all'
        ],
        'clientPrivs': []
    }
])


await addClient(userInfo, {
    clientCode: 'statistic',
    clientName: '日志',
    clientSecret: tools.getUUID(),
    retUrls: ['localhost:11010', 'statistic.lc.jtxuexi.com'],
    needAuthProxy: true,
    order: 9,
    upstreams: [{host: 'micro-statistic-api-http:80', weight: 1}],
    endpoints: [{
        'endpointType': 'pc',
        'visitPath': 'https://statistic.lc.jtxuexi.com',
        'status': 0,
    }]
})

await addClient(userInfo, {
    clientCode: 'transform',
    clientName: '转换服务',
    clientSecret: tools.getUUID(),
    retUrls: ['localhost:11020', 'transform.lc.jtxuexi.com'],
    needAuthProxy: true,
    order: 10,
    upstreams: [{host: 'micro-transform-api-http:80', weight: 1}],
})

await addClient(userInfo, {
    clientCode: 'pptonline',
    clientName: '在线课件',
    clientSecret: tools.getUUID(),
    retUrls: ['localhost:11005', 'pptonline-m.lc.jtxuexi.com', 'localhost:15173', 'pptonline.lc.jtxuexi.com'],
    needAuthProxy: true,
    order: 4,
    upstreams: [{host: 'micro-pptonline-api-http:80', weight: 1}],
    endpoints: [{
        'endpointType': 'pc',
        'visitPath': 'https://pptonline-m.lc.jtxuexi.com',
        'status': 0,
    }]
})

await saveClientPageConfig(userInfo, 'pptonline', [
    {
        'name': '公开接口',
        'path': '/public-bin/*',
        'auth': false,
        'clientAuth': false,
        'privs': [],
        'clientPrivs': []
    },
    {
        'name': '课件llm接口',
        'path': '/llm/*',
        'auth': true,
        'clientAuth': false,
        'privs': [
            'all'
        ],
        'clientPrivs': []
    },
    {
        'name': '课件接口',
        'path': '/ppt*',
        'auth': true,
        'clientAuth': false,
        'privs': [
            'all'
        ],
        'clientPrivs': []
    },
    {
        'name': 'AI工具接口',
        'path': '/tools/*',
        'auth': true,
        'clientAuth': false,
        'privs': [
            'all'
        ],
        'clientPrivs': []
    }
])

console.log('done')