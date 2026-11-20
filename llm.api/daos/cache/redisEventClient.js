/**
 * @fileOverview 任务事件日志的专用 Redis 客户端（M1-c/D38）
 * @module daos/cache/redisEventClient
 * @description
 * D38 的落地件：**事件日志不得与分布式锁共用连接承载**。三条规矩：
 * 1. **独立连接、独立逻辑库**：参数继承 `redisConfig`（host/port/凭据），db 用
 *    `redisEventConfig.db`（默认 12；cache=10、redlock=11 各归各）——容量核算从此可分账；
 * 2. **绝不用主单例做 XREAD BLOCK**：阻塞读会把共享连接挂住，锁与聊天缓存跟着陪葬
 *    （u2u/runControl 的 `duplicate()` 先例是同一课，这里干脆独立成客户端）；
 * 3. **延迟加载 + fail-open**：拿不到客户端返回 null，调用方静默降级（镜像是加法，
 *    不许变成编排关键路径的新故障源——runEventLogStore 纪律逐字继承）。
 */

const logger = (typeof llm !== 'undefined' && llm.logger) ? llm.logger : console

/** @type {Object|null} ioredis 单例（本模块私有，绝不 export 可变引用） */
let client = null
let loadPromise = null

/**
 * @description 取专用客户端（懒建连；失败返回 null，下次调用重试）
 * @returns {Promise<Object|null>}
 */
export async function getEventClient() {
    if (client) return client
    if (loadPromise) return loadPromise
    loadPromise = (async () => {
        try {
            const Redis = (await import('ioredis')).default
            const rc = llm.config.redisConfig || {}
            const ec = llm.config.redisEventConfig || {}
            client = new Redis({
                host: ec.host || rc.host,
                port: ec.port || rc.port,
                username: ec.username || rc.username,
                password: ec.password || rc.password,
                db: Number.isFinite(ec.db) ? ec.db : 12,
                // 事件镜像是尽力而为的旁路：建连失败别把重试排成长队拖住调用方
                maxRetriesPerRequest: 2,
                enableOfflineQueue: false,
                lazyConnect: true,
            })
            client.on('error', (e) => {
                // ioredis 自己会重连；这里只留一行证据，不抛（fail-open）
                logger.warn(`redisEventClient 连接错误（事件镜像降级）: ${String(e?.message || e).slice(0, 140)}`)
            })
            await client.connect()
            return client
        } catch (e) {
            logger.warn(`redisEventClient 不可用，任务事件镜像按不可用处理: ${String(e?.message || e).slice(0, 140)}`)
            client = null
            return null
        } finally {
            loadPromise = null
        }
    })()
    return loadPromise
}

/**
 * @description 测试/停机钩子：关掉连接（幂等）
 */
export async function closeEventClient() {
    if (client) {
        try { await client.quit() } catch { client.disconnect() }
        client = null
    }
}

export default { getEventClient, closeEventClient }
