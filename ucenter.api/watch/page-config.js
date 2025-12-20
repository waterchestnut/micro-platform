/**
 * @fileOverview 页面路由权限配置变量监听
 * @author xianyang 2025/3/21
 * @module
 */

import {loadPageConfig} from '../services/auth/page.js'
import {PageConfig} from '../daos/core/schema/index.js'

const logger = ucenter.logger
const tools = ucenter.tools

PageConfig.watch([{
    $match: {
        operationType: {
            $in: ['insert', 'update', 'delete']
        }
    }
}], {fullDocument: 'updateLookup', batchSize: 30}).on('change', async data => {
    return handle(data)
})

async function handle(data, tryTimes = 0) {
    try {
        await loadPageConfig()
    } catch (err) {
        logger.error(`Failed to watch PageConfig, data:${data}, error: ${err}`)
    }
}