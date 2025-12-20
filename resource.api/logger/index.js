/**
 * @fileOverview 日志记录管理
 * @author xianyang
 */

import pino from 'pino'

export const accessLoggerOptions = {
    level: resource.config.debug ? 'trace' : 'error',
    name: resource.appName,
    transport: {
        targets: [
            {
                level: 'trace',
                target: 'pino/file',
                options: {
                    destination: resource.baseDir + 'log/access/access.log',
                    mkdir: true
                }
            },
            {
                level: 'info',
                target: 'pino-pretty'
            },
            {
                level: 'error',
                target: resource.baseDir + 'logger/transports/kafka.js'
            }
        ]
    }
}

export function getAccessLogger() {
    return pino(
        {
            level: accessLoggerOptions.level,
            name: accessLoggerOptions.name,
        },
        pino.transport(accessLoggerOptions.transport)
    )
}

export function getAppLogger() {
    return pino(
        {
            level: resource.config.debug ? 'trace' : 'error',
            name: resource.appName,
        },
        pino.transport({
            targets: [
                {
                    level: 'trace',
                    target: 'pino/file',
                    options: {
                        destination: resource.baseDir + 'log/app/app.log',
                        mkdir: true
                    }
                },
                {
                    level: 'info',
                    target: 'pino-pretty'
                },
                {
                    level: 'error',
                    target: resource.baseDir + 'logger/transports/kafka.js'
                }
            ]
        })
    )
}