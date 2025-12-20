import fp from 'fastify-plugin'
import config from '../conf/system.config.js'

// the use of fastify-plugin is required to be able
// to export the decorators to the outer scope

export default fp(async function (fastify, opts) {
    fastify.decorate('sysConfig', config)
    fastify.decorate('env', function () {
        return config.debug ? 'development' : 'production'
    })
})
