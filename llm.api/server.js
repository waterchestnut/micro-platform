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
/**
 * 停机三件套：尺寸换算、状态位、关闭编排（都可离线测）。
 * 抽出来的原因是本机发不出可用 SIGTERM（Windows 的 taskkill /F 等价 SIGKILL，不触发处理器），
 * **不可测的关闭逻辑等于没写**。
 */
import {resolveCloseGraceDelay} from './services/core/session/shutdownPolicy.js'
import {beginShutdown} from './services/core/session/shutdownState.js'
import {closeWithRescue} from './services/core/session/shutdownSequence.js'

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
/**
 * 停机尺寸必须走 `resolveCloseGraceDelay` 换算成**数字**（接线自源仓 §25 v1.37–v1.43）。
 * 旧写法 `process.env.X || 25000` 传下去的是字符串，而 `close-with-grace@2.2` 第 24 行是
 * `typeof opts.delay === 'number' ? opts.delay : undefined` ⇒ 字符串被判成"无上限"，
 * **这条 env 从来没生效过**，线上看起来"配了 45s"其实是"没有上限、由 k8s 硬切"。
 * 源仓实测：`kill` 档 SIGTERM 后仍送了 103,984ms 才自然结束。
 */
const closeGrace = resolveCloseGraceDelay({
    envValue: process.env.FASTIFY_CLOSE_GRACE_DELAY,
    terminationGraceSeconds: process.env.TERM_GRACE_PERIOD_SECONDS,
    /** 清单里的 preStop `sleep 5` 与 grace 来自同一个窗口，不传进来就会被静默重复使用（源仓 §25 v1.54） */
    preStopSeconds: process.env.PRE_STOP_SECONDS,
})
/** 生效值必须成为可读事实：配了却没生效这种事故，靠注释拦不住 */
app.log.info(`停机宽限: delay=${closeGrace.delayMs}ms, env采纳=${closeGrace.applied}, reason=${closeGrace.reason}`)

const closeListeners = closeWithGrace({delay: closeGrace.delayMs},
    async function ({signal, err, manual}) {
        /**
         * 第一件事必须是置停机状态位：在途 run 要靠它区分"用户按停止"与"发版拆连接"。
         * 放在 app.close() 之后就来不及了——app.close() 会等在途请求，那段等待里断开随时到达。
         */
        beginShutdown({signal: signal || (manual ? 'manual' : '')})
        if (err) {
            app.log.error(err)
        }
        /**
         * 关闭编排在 `closeWithRescue`：先等在途跑完，到点没跑完的**主动落档并停止生成**，
         * 收尾仍交给 app.close() 的 promise（检查点 flush → 关 mongo → 断 redis）。
         * 为什么这段必须在 run 之外还有一个主动动作：源仓实测真实滚动里**应用收不到断开事件**
         * （网关只拆客户端侧），被动等 socket close 等于什么都没做。
         */
        await closeWithRescue({
            app,
            delayMs: closeGrace.delayMs,
            log: (msg, obj) => app.log.warn(msg, obj),
        })
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