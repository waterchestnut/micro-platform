/**
 * @fileOverview
 * @author xianyang 2024/5/26
 * @module
 */

import build from 'pino-abstract-transport'
import '../../global.js'

export default async function (opts) {
    const {saveStatisticContent} = await import('../../services/statistic/index.js')
    return build(async function (source) {
        for await (let logObj of source) {
            try {
                /*console.log('kafka', logObj)*/
                await saveStatisticContent('log-pino-' + getLevelLabel(logObj?.level), JSON.stringify(logObj), logObj)
            } catch (e) {
                // 统计日志发送失败只丢这一条；绝不把异常抛出for-await循环，
                // 否则transport停读后、后续日志会在工作线程缓冲里无限堆积（proposals/kafka-client-stream-leak）
            }
        }
    })
}

function getLevelLabel(level) {
    const levels = {
        10: 'trace',
        20: 'debug',
        30: 'info',
        40: 'warn',
        50: 'error',
        60: 'fatal',
    }
    return levels[level] || level
}
