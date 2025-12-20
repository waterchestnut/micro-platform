import fp from 'fastify-plugin'
import cookie from '@fastify/cookie'

/**
 * This plugin for Fastify that adds support for reading and setting cookies.
 *
 * @see https://github.com/fastify/fastify-cookie
 */
export default fp(async (fastify) => {
    fastify.register(cookie, {
        secret: resource.config.cookieSecret, // for cookies signature
        hook: 'onRequest', // set to false to disable cookie autoparsing or set autoparsing on any of the following hooks: 'onRequest', 'preParsing', 'preHandler', 'preValidation'. default: 'onRequest'
        parseOptions: {}  // options for parsing cookies
    })
})
