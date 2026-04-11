/**
 * @fileOverview 执行初始化数据
 * @author xianyang
 * @module
 */

import '../init.js'
import {addClient} from '../services/core/client.js'

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
    upstreams: [{host: 'micro-ucenter-api-http:12001', weight: 1}]
})

await addClient(userInfo, {
    clientCode: 'app',
    clientName: '应用管理',
    clientSecret: tools.getUUID(),
    retUrls: ['localhost:11003', 'app.lc.jtxuexi.com'],
    needAuthProxy: true,
    order: 3,
    upstreams: [{host: 'micro-app-api-http:12003', weight: 1}]
})

console.log('done')