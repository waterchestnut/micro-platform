/**
 * @fileOverview 进程级资源的释放（onClose）
 * @module plugins/lifecycle
 * @description
 * 三个单例在**模块加载时**就建立了连接，而 `app.close()` 不会释放它们：
 * - `daos/core/schema/index.js`：顶层 `await mongoose.createConnection(...)`
 * - `daos/cache/redisClient.js`：`new Redis(llm.config.redisConfig)`
 * - `daos/redlock.js`：`new Redis(configPath)`
 *
 * 后果有两条，是同一条缺陷的两面：
 * 1. **测试**：`test/routes/*.test.js` 的用例本身通过，但文件不退出 ⇒ `npm test` 会一直挂着
 *    （或需要 `--test-force-exit` 才能收尾）。
 * 2. **生产**：`server.js` 的 `closeWithGrace({delay: 500})` 之后并没有人关连接，
 *    优雅停机实际靠 SIGKILL 收尾。
 *
 * 三条纪律：
 * - **绝不因为清理卡住而拖长停机**：每一项都 try/catch 并限时竞速，超时就放弃等待；
 * - **只关"确实建过"的连接**：ioredis 用 `disconnect()` 强制关闭，不用 `quit()`
 *   （quit 会等排队命令跑完，重连态下可能永不返回）；
 * - 不新增模块级副作用：全部用动态 import，插件自身加载时不建任何连接。
 */

import fp from 'fastify-plugin'

/**
 * @description 给一个 promise 套上限时，超时只放弃等待（不抛错、不阻塞停机）
 * @param {Promise} p 待等待的 promise
 * @param {Number} ms 毫秒上限
 * @returns {Promise<String>} 'ok' | 'timeout' | 'error'
 */
async function bounded(p, ms) {
    const t = new Promise(resolve => setTimeout(() => resolve('timeout'), ms))
    return Promise.race([p.then(() => 'ok', () => 'error'), t])
}

export default fp(async function (fastify, opts) {

    /* 注意：Fastify 的钩子要么 promise 要么 callback，混用会有歧义 ⇒ 这里只用 async 单参形态 */
    fastify.addHook('onClose', async (instance) => {
        const budget = Number(process.env.FASTIFY_CLOSE_RESOURCE_TIMEOUT_MS || 3000)
        const closed = []

        /*1) mongodb：从任一 Model 拿到它所属的 Connection，不要求 schema 模块额外导出*/
        try {
            const models = await import('../daos/core/schema/index.js')
            const anyModel = Object.values(models).find(v => v && v.db)
            if (anyModel?.db?.readyState !== 0) {
                const r = await bounded(anyModel.db.close(), budget)
                closed.push(`mongodb:${r}`)
            } else {
                closed.push('mongodb:not-open')
            }
        } catch (e) {
            closed.push(`mongodb:error(${String(e.message || e).slice(0, 60)})`)
        }

        /*2) 缓存 Redis*/
        try {
            const redisClient = (await import('../daos/cache/redisClient.js')).default
            if (redisClient?.client) {
                redisClient.client.disconnect()
                closed.push('redis:cache:disconnected')
            }
        } catch (e) {
            closed.push(`redis:cache:error(${String(e.message || e).slice(0, 60)})`)
        }

        /*3) 分布式锁 Redis*/
        try {
            const redlock = (await import('../daos/redlock.js')).default
            const clients = redlock?.clients || []
            clients.forEach(c => {
                try { if (typeof c?.disconnect === 'function') c.disconnect() } catch { /* 忽略：停机路径不抛错 */ }
            })
            closed.push(`redis:redlock:${clients.length}`)
        } catch (e) {
            closed.push(`redis:redlock:error(${String(e.message || e).slice(0, 60)})`)
        }

        instance.log?.info?.(`资源释放完成：${closed.join(', ')}`)
    })
}, {name: 'lifecycle'})
