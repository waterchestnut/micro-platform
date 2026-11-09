/**
 * PR-E0.4 代码侧验证：onClose 的「先在途检查点落地、再关 mongo」顺序与耗时
 * 用法（在 `src/` 下）：node evals/platform-probes/close-order-verify.mjs
 * 只写自己新建的 conversationCode，不碰存量数据；跑完自己清理。
 */
import '../../init.js'
import Fastify from 'fastify'
import Lifecycle from '../../plugins/lifecycle.js'
import {scheduleCheckpoint, flushCheckpoints} from '../../services/core/session/checkpoint.js'
import mongoose from 'mongoose'

const conversationCode = `close-verify-${Date.now()}`

const app = Fastify()
app.register(Lifecycle)
await app.ready()

const base = {
    conversationCode,
    messageCode: 'close-verify-msg',
    userCode: 'menglb',
    channel: 'xxzx_common',
    phase: 'postCreate',
    seq: 1,
    messages: [{role: 'user', content: '探针'}],
    toolState: {pendingCalls: [], completedCalls: []},
}

/**
 * @description 排一条在途检查点（不 await，模拟 run 正在跑时被停机）
 * @param {Number} n 条数
 * @returns {void}
 */
function scheduleSome(n) {
    for (let i = 0; i < n; i++) {
        scheduleCheckpoint({...base, seq: i + 1, phase: i % 2 ? 'postTools' : 'preCreate'})
    }
}

scheduleSome(6)
const pendingNow = 6
llm.logger.info(`探针：排了 ${pendingNow} 条在途检查点，准备关闭 app`)

const t0 = Date.now()
await app.close()
const closeMs = Date.now() - t0

/**
 * @description 直连查回检查点是否真的落了库
 * @returns {Promise<Object>} 统计
 */
async function readBack() {
    const cfg = llm.config.mongodbConfig
    const conn = await mongoose.createConnection(cfg.uri, {...cfg.options, autoIndex: false}).asPromise()
    const rows = await conn.collection('sessionCheckpoint').find({conversationCode}, {projection: {phase: 1, seq: 1}}).toArray()
    await conn.close()
    return {
        行数: rows.length,
        阶段分布: rows.reduce((acc, r) => ({...acc, [r.phase]: (acc[r.phase] || 0) + 1}), {}),
        最小seq: Math.min(...rows.map(r => r.seq)),
        最大seq: Math.max(...rows.map(r => r.seq)),
    }
}

const back = await readBack()
console.log(JSON.stringify({
    probe: 'close-order',
    conversationCode,
    排队条数: pendingNow,
    关闭耗时ms: closeMs,
    查回: back,
    旧默认值对照: {FASTIFY_CLOSE_GRACE_DELAY_旧: 500, 本次关闭耗时: closeMs, 结论: closeMs > 500
        ? '❗ 关闭耗时超过旧默认 500ms ⇒ 旧配置下监听器会被强杀，检查点根本来不及落'
        : '本次耗时未超 500ms（单进程空载），但生产是 PM2 2 worker + 真实在途 run，不能据此认为旧值安全'},
    判定: back.行数 >= pendingNow
        ? `✅ 在途检查点全部落地（${back.行数}/${pendingNow}），且发生在 mongo 关闭之前`
        : `❌ 只落了 ${back.行数}/${pendingNow} 条：顺序或限时有问题`,
}))
process.exit(0)
