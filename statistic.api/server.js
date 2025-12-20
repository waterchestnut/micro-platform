/**
 * @fileOverview 独立方式启动
 * @author xianyang 2025/2/8
 * @module
 */

import appService from './app.js'
import closeWithGrace from 'close-with-grace'
import Fastify from 'fastify'
import {accessLoggerOptions} from './logger/index.js'
import {parseJSON} from "./tools/index.js"

// Instantiate Fastify with some config
const app = Fastify({
    logger: accessLoggerOptions,
    trustProxy: parseJSON(process.env.FASTIFY_TRUST_PROXY ?? false),
    bodyLimit: process.env.FASTIFY_BODY_LIMIT ? parseInt(process.env.FASTIFY_BODY_LIMIT) : undefined,
    maxParamLength: process.env.FASTIFY_MAX_PARAM_LENGTH ? parseInt(process.env.FASTIFY_MAX_PARAM_LENGTH) : undefined
})

// Register your application as a normal plugin.
app.register(appService)

// delay is the number of milliseconds for the graceful close to finish
const closeListeners = closeWithGrace({delay: process.env.FASTIFY_CLOSE_GRACE_DELAY || 500},
    async function ({signal, err, manual}) {
        if (err) {
            app.log.error(err)
        }
        await app.close()
    })

app.addHook('onClose', (instance, done) => {
    closeListeners.uninstall()
    done()
})

// Start listening.
app.listen({port: process.env.PORT || 3000, host: process.env.FASTIFY_ADDRESS || '0.0.0.0'}, (err, address) => {
    if (err) {
        app.log.error(err)
        process.exit(1)
    }
    app.log.info('服务器启动成功。')
    console.log('服务器启动成功。')
})