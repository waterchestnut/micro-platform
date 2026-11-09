/**
 * @fileOverview 独立方式启动
 * @author xianyang 2025/2/8
 * @module
 */

import appService from './app.js'
import closeWithGrace from 'close-with-grace'
import Fastify from 'fastify'
import {accessLoggerOptions} from './logger/index.js'
import {parseJSON} from './tools/index.js'

// Instantiate Fastify with some config
const app = Fastify({
    logger: accessLoggerOptions,
    trustProxy: parseJSON(process.env.FASTIFY_TRUST_PROXY ?? false),
    bodyLimit: process.env.FASTIFY_BODY_LIMIT ? parseInt(process.env.FASTIFY_BODY_LIMIT) : undefined,
    maxParamLength: process.env.FASTIFY_MAX_PARAM_LENGTH ? parseInt(process.env.FASTIFY_MAX_PARAM_LENGTH) : undefined,
    ajv: {
        customOptions: {
            removeAdditional: false,
            coerceTypes: true,
            allErrors: true,
        },
    },
})

// Register your application as a normal plugin.
app.register(appService)

/**
 * 停机宽限的**代码默认值**：25s（PR-E0.4，旧值 500ms）。
 *
 * 为什么不是"取实测最优的 45s"：这个默认值必须在**任何环境都没设 k8s grace 的情况下也成立**，
 * 而 `terminationGracePeriodSeconds` 的默认是 30s——代码默认值一旦高于它，
 * 没配 grace 的环境就是"承诺 45s 但 30s 就被 SIGKILL"：进程被硬杀，比旧值 500ms 更难看
 * （连检查点的 flush 都跑不到）。所以分层定值：
 *   - 代码默认 **25s** < k8s 默认 grace 30s（留 5s 给关闭序列本身）；
 *   - prod 在 manifest 里显式写 `FASTIFY_CLOSE_GRACE_DELAY=45000` **配** `terminationGracePeriodSeconds: 60`
 *     ——**两者必须成对改**，只调 delay 不调 grace 等于什么都没修。
 *
 * 45s 这个 prod 值是按实测 run 时长分布定的：简单问答 2.3s、700 字长生成 10.2s、
 * 工具链 24.0s（历史最长一次 31.2s），取最大值 + ~40% 余量。
 * 实测验证：`evals/platform-probes/shutdown-midrun-probe.mjs` —— `app.close()` 会等在途 SSE 跑完
 * （12996ms 收尾），那一轮照样 `progress:'finish'`、answerLen 700、留下 3 条检查点。
 *
 * 两条不能省略的认识：
 * 1. 宽限**替代不了续跑**——超过宽限的 run 照样被截，PR-C 的 checkpoint+resume 仍是必须的；
 * 2. 关闭序列是**有顺序的**：先在途检查点落地 → 关 mongo → 断两个 redis（见 plugins/lifecycle.js），
 *    顺序反了就是"想续跑但现场没了"。
 */
const closeListeners = closeWithGrace({delay: process.env.FASTIFY_CLOSE_GRACE_DELAY || 25000},
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