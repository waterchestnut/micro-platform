import './init.js'
import path from 'path'
import AutoLoad from '@fastify/autoload'
import {fileURLToPath} from 'url'
import {accessLoggerOptions} from './logger/index.js'
import {parseJSON} from './tools/index.js'
import {
    getAllDefinitionModels,
    getAllParamModels,
    getAllStoreModels
} from './daos/swaggerSchema/mongooseHandler.js'
import {getAllEnumModels} from './daos/swaggerSchema/enumHandler.js'
import {loadPageConfig} from './services/auth/page.js'

// 加载权限配置
import './watch/page-config.js'

await loadPageConfig()


const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Pass --options via CLI arguments in command to enable these options.
export const options = {
    logger: accessLoggerOptions,
    trustProxy: parseJSON(process.env.FASTIFY_TRUST_PROXY ?? false),
    maxParamLength: process.env.FASTIFY_MAX_PARAM_LENGTH ? parseInt(process.env.FASTIFY_MAX_PARAM_LENGTH) : undefined
}

export default async function (fastify, opts) {
    // Place here your custom code!
    fastify.addSchema({
        $id: 'fullStoreModels',
        type: 'object',
        properties: getAllStoreModels()
    })
    fastify.addSchema({
        $id: 'fullParamModels',
        type: 'object',
        properties: getAllParamModels()
    })

    fastify.addSchema({
        $id: 'fullDefinitionModels',
        type: 'object',
        properties: await getAllDefinitionModels()
    })

    fastify.addSchema({
        $id: 'fullEnumModels',
        type: 'object',
        properties: await getAllEnumModels()
    })

    // Do not touch the following lines

    // This loads all plugins defined in plugins
    // those should be support plugins that are reused
    // through your application
    fastify.register(AutoLoad, {
        dir: path.join(__dirname, 'plugins'),
        autoHooks: true,
        cascadeHooks: true,
        overwriteHooks: false,
        options: Object.assign({}, opts)
    })

    // This loads all plugins defined in routes
    // define your routes in one of these
    fastify.register(AutoLoad, {
        dir: path.join(__dirname, 'routes'),
        autoHooks: true,
        cascadeHooks: true,
        overwriteHooks: false,
        options: Object.assign({}, opts)
    })
}
