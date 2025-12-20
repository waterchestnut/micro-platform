import fp from 'fastify-plugin'
import cors from '@fastify/cors'

const tools = rag.tools
const logger = rag.logger
const config = rag.config

/**
 * This plugin for Fastify that enables the use of CORS in a Fastify application.
 *
 * @see https://github.com/fastify/fastify-cors
 */
export default fp(async (fastify) => {
    fastify.register(cors, (instance) => {
        return (req, callback) => {
            const corsOptions = {
                origin: false
            }

            let reqOrigin = req.headers.origin;
            if (tools.isOriginAllowed(reqOrigin, config.allowedOrigins)) {
                corsOptions.origin = true
            }
            callback(null, corsOptions)
        }
    })

})
