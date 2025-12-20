/**
 * @fileOverview 日志记录管理
 * @author xianyang
 */

import pino from 'pino'

export const accessLoggerOptions = {
    level: doc.config.debug ? 'trace' : 'error',
    name: doc.appName,
    transport: {
        targets: [
            {
                level: 'trace',
                target: 'pino/file',
                options: {
                    destination: doc.baseDir + 'log/access/access.log',
                    mkdir: true
                }
            },
            {
                level: 'info',
                target: 'pino-pretty'
            },
            {
                level: 'error',
                target: doc.baseDir + 'logger/transports/kafka.js'
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
            level: doc.config.debug ? 'trace' : 'error',
            name: doc.appName,
        },
        pino.transport({
            targets: [
                {
                    level: 'trace',
                    target: 'pino/file',
                    options: {
                        destination: doc.baseDir + 'log/app/app.log',
                        mkdir: true
                    }
                },
                {
                    level: 'info',
                    target: 'pino-pretty'
                },
                {
                    level: 'error',
                    target: doc.baseDir + 'logger/transports/kafka.js'
                }
            ]
        })
    )
}