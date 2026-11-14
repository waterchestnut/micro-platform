import './init.js'
import path from 'path'
import fastifyStatic from '@fastify/static'
import AutoLoad from '@fastify/autoload'
import {FastifySSEPlugin} from 'fastify-sse-v2'
import {fileURLToPath} from 'url'
import {accessLoggerOptions} from './logger/index.js'
import {parseJSON} from './tools/index.js'
import {reportSecretSources, assertSecretEnvPresent} from './tools/secretSources.js'
import {
    getAllDefinitionModels,
    getAllParamModels,
    getAllStoreModels
} from './daos/swaggerSchema/mongooseHandler.js'
import {getAllEnumModels} from './daos/swaggerSchema/enumHandler.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/** 凭据来源审计每进程只报一次（测试里会 build 多个 app 实例，重复刷同一条 warn 只会让人学会忽略它） */
let secretAuditReported = false

// Pass --options via CLI arguments in command to enable these options.
export const options = {
    logger: accessLoggerOptions,
    trustProxy: parseJSON(process.env.FASTIFY_TRUST_PROXY ?? false),
    routerOptions: {
        maxParamLength: process.env.FASTIFY_MAX_PARAM_LENGTH ? parseInt(process.env.FASTIFY_MAX_PARAM_LENGTH) : undefined
    },
    ajv: {
        customOptions: {
            removeAdditional: false,
            coerceTypes: true,
            allErrors: true,
            /**
             * 消除启动期 10 条 `strict mode: use allowUnionTypes ...` 噪音（§16.1 待办 / 实测 dev 双 pod 每次启动都刷）。
             * `chatStreamSchema` 里 `cache`/`enableThinking`/`memory.*` 等 10 个字段是 `type: ['x','null']` 联合类型，
             * ajv 严格模式默认对联合类型告警——**只是提醒，不改判定结果**：打开后这些 schema 的校验行为逐字不变，
             * 只是不再刷这 10 行。为什么值得动这一行：本仓刚给启动日志加了 E0.2 凭据审计、E0.6 出网态势两条**真该被看到的 warn**，
             * 而每次启动 10 行样板噪音会把它们埋掉（"日志里全是无害告警"正是让人学会忽略告警的最快方式）。
             * 静掉噪音是为了让治理告警有信号量，不是为了好看。
             */
            allowUnionTypes: true,
        },
    },
}

export default async function (fastify, opts) {
    // Place here your custom code!

    // 支持sse
    fastify.register(FastifySSEPlugin)
    // 静态资源：将项目下 test 目录映射到 /test/
    fastify.register(fastifyStatic, {
        root: path.join(__dirname, 'test'),
        prefix: '/test/',
        index: ['index.html']
    })
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

    /**
     * PR-E0.2 第一步：**让"正在用代码兜底的凭据"在启动日志里出现一次**。
     * 只报 env 名与数量，绝不报值；每进程一次（多次 build 的测试进程不重复刷）。
     * 为什么现在只做这一半：删兜底与"缺 env 拒绝启动"必须等运维先把 env 配上——
     * dev 三个 deployment 目前这 5 个 env **一个都没配**，先删就是发版即 401（§25 的 relay key 事故）。
     */
    if (!secretAuditReported) {
        secretAuditReported = true
        reportSecretSources(llm.logger)
        /**
         * PR-E0.2 第三步：默认关的启动闸门。`secrets_requireEnv=true` 且仍有凭据在用源码兜底 ⇒ 拒绝启动。
         * 关 ⇒ 什么都不做（与加它之前逐字一致）。先 warn 后判，保证"即便要拒也把原因写进日志"。
         */
        assertSecretEnvPresent({requireEnv: llm.config?.secrets?.requireEnv === true})
    }

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
