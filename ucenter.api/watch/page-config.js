/**
 * @fileOverview 页面路由权限配置变量监听
 * @author xianyang 2025/3/21
 * @module
 */

import {loadPageConfigSafe} from '../services/auth/page.js'
import {PageConfig} from '../daos/core/schema/index.js'

const logger = ucenter.logger

let changeStream = null
let restartTimer = null
let restartTimes = 0

startWatch()

// mongodb重连后change stream可能已中断，全量刷新一次配置并重建监听，补齐断连期间丢失的变更
PageConfig.connection.on('reconnected', () => {
    logger.info('MongoDB reconnected, reloading page config and restarting watch')
    loadPageConfigSafe()
    startWatch()
})

/**
 * @description 开启PageConfig变更流监听，失败时指数退避重试
 * @author menglb
 */
function startWatch() {
    try {
        closeWatch()
        changeStream = PageConfig.watch([{
            $match: {
                operationType: {
                    $in: ['insert', 'update', 'delete']
                }
            }
        }], {fullDocument: 'updateLookup', batchSize: 30})
        changeStream.on('change', () => {
            loadPageConfigSafe()
        })
        // mongodb重启后change stream可能无法resume，必须注册error监听，否则未处理的error事件会导致进程崩溃
        changeStream.on('error', err => {
            logger.error(`PageConfig change stream error: ${err}`)
            scheduleRestart()
        })
        restartTimes = 0
    } catch (err) {
        logger.error(`Failed to watch PageConfig: ${err}`)
        scheduleRestart()
    }
}

function closeWatch() {
    const stream = changeStream
    changeStream = null
    if (!stream) return
    try {
        stream.removeAllListeners()
        const ret = stream.close()
        if (ret && typeof ret.catch === 'function') {
            ret.catch(() => {})
        }
    } catch (err) {
        /* 忽略关闭异常，由重试逻辑重建监听 */
    }
}

function scheduleRestart() {
    if (restartTimer) return
    const delay = Math.min(30000, 1000 * 2 ** Math.min(restartTimes++, 5))
    restartTimer = setTimeout(() => {
        restartTimer = null
        startWatch()
    }, delay)
    if (typeof restartTimer.unref === 'function') {
        restartTimer.unref()
    }
}
