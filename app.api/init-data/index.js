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
    retUrls: ['localhost:11001', 'micro.lc.jtxuexi.com']
})

console.log('done')