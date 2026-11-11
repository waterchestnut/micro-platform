/**
 * @fileOverview 一轮 run 的 SSE 事件日志（PR-C 的 `/resume` 数据源）
 * @module services/core/session/runEventLog
 * @description
 * 存在的理由：D34 把"断线重连"定为**可用性下限**而不是优化项——Traefik `idleTimeout=180s` 在
 * k8s 注解路径下不可调，连接必然被切。要能续，就必须有"已经成功送达过哪些事件"的记录；
 * 而 `:ping`（v1.19）只解决"不被切"，不解决"被切之后怎么接回来"。
 *
 * 前置条件已经在了：`sseChannel` 从 v1.31 起**只在写成功时才落下 seq**，
 * 所以日志里不会出现"占了号却没人收到"的空洞——这正是模块注释里预告的 §19 第 2 条。
 *
 * 四条 SSE 不变量在本模块的落点（§19 / §26 G-4）：
 * 1. **ID 严格单调** ⇒ `record()` 拒绝回退号，重复号直接报错而不是悄悄覆盖；
 * 2. **不跳过任何保留事件** ⇒ `since(lastSeq)` 从 `lastSeq+1` 起连续给；一旦最早的保留号
 *    比 `lastSeq+1` 大，就**必须显式给出 gap**，绝不"有什么给什么"（那是静默丢事件）；
 * 3. **不完整帧不推进游标** ⇒ 属于客户端侧，本模块只提供完整帧，不参与记号；
 * 4. **心跳注释不进业务事件列表** ⇒ 日志只由 `emit` 成功路径写入，`ping()` 走不到这里。
 *
 * gap 是一等返回（不是裸 410）：`gapBody()` 给出机器可读的 `{code, since, oldest, snapshotUrl}`。
 *
 * 一条必须说清的局限：日志在**进程内存**里。跨副本续接需要外部承载（PR-C 已定 Redis，
 * §25 的 Redis 运维税那格），本模块不假装能跨 pod。
 */

/** 默认单轮保留的事件条数：一轮实测 12~400+ 帧，给 2000 足够覆盖长工具链且上限可算 */
export const DEFAULT_MAX_EVENTS = 2000

/**
 * 默认单轮保留的字节数（载荷合计，2MB）。
 *
 * 为什么条数上限不够：`tool_result` 一帧就能有几十 KB，"2000 条"在纯文本轮里是 200KB、
 * 在重工具轮里能到几十 MB——**同一个上限在两种轮次里代表的内存差两个数量级**，
 * 那等于没有上限。这里按字节封顶，内存才是可算的。
 *
 * 淘汰至少留一条（见 `record`），所以真实峰值 ≈ 本值 + 一帧的大小。
 */
export const DEFAULT_MAX_BYTES = 2 * 1024 * 1024

/** gap 的机器可读码（前端据此走快照重建，而不是把错误原文显示给用户） */
export const GAP_CODE = 'EVENT_BUFFER_EXPIRED'

/**
 * 快照重建的落点。取 `/core/message/list` 是因为 `/core/message` 下**只有 `list` 与 `feedback`**
 * 两个端点（`routes/core/message/root.js`），而第一版的默认值 `/core/message/detail` 根本不存在。
 */
export const DEFAULT_SNAPSHOT_URL = '/core/message/list'

/**
 * @description gap 响应体的唯一构造处（进程内日志与 Redis 镜像共用同一个形状）
 * @param {Object} p 参数
 * @param {String} p.messageCode 本轮标识
 * @param {Object} p.gap `{since, oldest, latest}`
 * @param {String} [p.conversationCode] 会话标识
 * @param {String} [p.source] 记录来源（local/redis），排障时区分"本机丢了"与"跨副本读到截断"
 * @returns {Object} 响应体
 */
export function gapBodyOf({messageCode, gap, conversationCode = '', source = 'local'}) {
    return {
        code: GAP_CODE,
        msg: `事件缓冲已过期：游标 ${gap.since} 之后的事件无法保证连续`
            + `（最早保留 ${gap.oldest}${gap.missingFrom ? `，缺失自 ${gap.missingFrom}` : ''}），请走快照重建`,
        since: gap.since,
        oldest: gap.oldest,
        latest: gap.latest ?? null,
        missingFrom: gap.missingFrom ?? null,
        source,
        snapshotUrl: DEFAULT_SNAPSHOT_URL,
        snapshotRequest: {
            method: 'POST',
            url: DEFAULT_SNAPSHOT_URL,
            body: {filter: {messageCode, ...(conversationCode ? {conversationCode} : {})}},
        },
        messageCode,
    }
}

/**
 * @description 建一轮的事件日志
 * @param {Object} [opts] 参数
 * @param {Number} [opts.maxEvents] 保留条数上限（超限丢最早若干条，并留下 gap 依据）
 * @param {Number} [opts.maxBytes] 保留字节上限（同上，但内存可算；0/负数取默认值）
 * @param {String} [opts.messageCode] 关联的 run（诊断用）
 * @param {String} [opts.conversationCode] 所属会话（gap 的快照重建请求要带它才能命中可见性收敛）
 * @returns {Object} 日志句柄
 */
export function createRunEventLog({
    maxEvents = DEFAULT_MAX_EVENTS,
    maxBytes = DEFAULT_MAX_BYTES,
    messageCode = '',
    conversationCode = '',
} = {}) {
    const cap = Number(maxEvents) > 0 ? Number(maxEvents) : DEFAULT_MAX_EVENTS
    const byteCap = Number(maxBytes) > 0 ? Number(maxBytes) : DEFAULT_MAX_BYTES
    /** @type {Array<{seq:Number,event:String,data:String,at:Number,bytes:Number}>} */
    const items = []
    /** 当前保留条目的载荷字节合计：淘汰判据用它，不能到淘汰时再遍历求和 */
    let bytes = 0
    let lastSeq = 0
    /** 被淘汰出去的最大号：`since()` 用它判断请求的游标是否还在保留范围内 */
    let evictedThrough = 0
    /** 单帧就超过字节预算的次数：内存是"预算 + 一帧"，这个读数让代价可见 */
    let oversized = 0
    let closed = false
    const subs = new Set()

    /**
     * @description 按预算淘汰最早的条目（条数或字节任一超线都触发）
     *              **始终保留最后一条**：否则一条巨帧就能把整轮清空，续接会报"没有事件"而不是 gap
     * @returns {void}
     */
    function fit() {
        while (items.length > 1 && (items.length > cap || bytes > byteCap)) {
            const cut = items.shift()
            bytes -= cut.bytes
            evictedThrough = cut.seq
        }
    }

    /**
     * @description 记一条已成功送达的事件
     * @param {Number} seq sseChannel 分配到的号
     * @param {String} event 事件名
     * @param {String} data 载荷
     * @returns {Object} 记入的条目
     */
    function record(seq, event, data) {
        const n = Number(seq)
        if (!Number.isInteger(n) || n <= 0) {
            throw new Error(`runEventLog.record: 非法 seq ${seq}`)
        }
        /**
         * 不变量 1：号必须严格递增。
         * 回退或重复都说明调用方（或未来的 Redis 版本）串了，
         * 这里**抛错**而不是覆盖——静默覆盖会让续接看起来成功、实际给了错的那条。
         */
        if (n <= lastSeq) {
            throw new Error(`runEventLog.record: seq 必须严格递增（收到 ${n}，已记 ${lastSeq}）`)
        }
        lastSeq = n
        const text = String(data ?? '')
        const item = {seq: n, event: event || 'delta', data: text, at: Date.now(), bytes: text.length}
        items.push(item)
        bytes += item.bytes
        if (item.bytes > byteCap) {
            /** 一帧就吃掉整个预算：留着它（丢掉最新事件会让续接更错），但把代价记成读数 */
            oversized++
        }
        fit()
        for (const cb of [...subs]) {
            try {
                cb(item)
            } catch (e) {
                /** 订阅者出错不能影响主流程：日志是旁路观测，不是关键路径 */
            }
        }
        return item
    }

    /**
     * @description 取 `lastSeq` 之后的全部保留事件
     * @param {Number} lastSeq 客户端游标
     * @returns {{events: Object[], gap: Object|null}} gap 非空时表示**不能**安全续接
     */
    function since(lastSeqArg = 0) {
        const from = Number(lastSeqArg) || 0
        const wantNext = from + 1
        const oldest = items.length ? items[0].seq : (evictedThrough + 1)
        /**
         * 不变量 2 的另一半：如果客户端要的下一号已经被淘汰，
         * **必须报 gap**，不能"有什么给什么"——那样前端会把缺的那段当成没发生过。
         */
        if (evictedThrough > 0 && wantNext <= evictedThrough) {
            return {events: [], gap: {code: GAP_CODE, since: from, oldest, latest: lastSeq}}
        }
        return {events: items.filter(x => x.seq >= wantNext), gap: null}
    }

    /**
     * @description gap 的机器可读错误体（一等返回，不是裸 410）
     * @param {Object} gap `since()` 给出的 gap
     * @param {Object} [opt] 附加项
     * @param {String} [opt.snapshotUrl] 快照重建指引
     * @returns {Object} 响应体
     *
     * `snapshotUrl` 的默认值必须指向**真实存在的端点**：第一版我写的是
     * `/core/message/detail?messageCode=...`，而 `/core/message` 下只有 `list` 与 `feedback`
     * ——凭空造的路标交给前端，就是让下一次 gap 变成"前端照着做然后 404"。
     * 现在指向 `/core/message/list` 并把 POST 的形状一起给出去（`snapshotRequest`），
     * 因为它是 POST + filter，光有 URL 前端仍然拼不出请求。
     * 这条由 `test/routes/chatResume.test.js` 的路由表守卫钉住。
     */
    function gapBody(gap, {snapshotUrl = ''} = {}) {
        /**
         * 统一走 `gapBodyOf`：进程内日志与 Redis 镜像必须是**同一个形状**，
         * 否则前端要为两种续接来源写两套分支，而这两套分支迟早不一致。
         * 调用方显式给了 snapshotUrl 时才覆盖（保留旧能力）。
         */
        const body = gapBodyOf({messageCode, gap, conversationCode})
        return snapshotUrl ? {...body, snapshotUrl} : body
    }


    /**
     * @description 订阅新事件（用于"补发完接着直播"）
     * @param {Function} cb 回调
     * @returns {Function} 取消订阅
     */
    function subscribe(cb) {
        subs.add(cb)
        return () => subs.delete(cb)
    }

    /**
     * @description 先订阅、再读缓冲：补发历史 + 接续直播，且**不丢不重**
     * @param {Number} lastSeq 客户端游标
     * @param {Function} onEvent `(item) => void`；按 seq 升序收到每一条
     * @returns {{cancel: Function, result: Object}} result 是 `since()` 的判定（含 gap）
     *
     * 顺序是这段代码的全部难点，写反就是丢事件：
     * - 若"先 `since()` 读缓冲、再 `subscribe()`"，那么这两步之间产生的事件
     *   既不在缓冲快照里、也没被订阅捕获 ⇒ **静默消失**，而且症状只在断线重连时出现，最难复现；
     * - 所以先订阅（把新到的先扣在 pending 里），再读 `since()`，
     *   最后按 seq 归并：**已扣的号若落在补发区间里就丢掉**（重复），否则说明它比快照更新（正常接续）。
     */
    function replayThenLive(lastSeq, onEvent) {
        const pending = []
        const seen = new Set()
        /** 单一队列 + 排空标志：任何时刻只有一个泵在跑，重入的事件排在队列里按序发 */
        let pumping = false
        let replaying = true

        /**
         * @description 把队列里最小的号先发出去
         * @returns {void}
         */
        function pump() {
            if (pumping) {
                /** 已经有一个泵在发（onEvent 里又产生了新事件）：交给它，避免倒序与重入爆栈 */
                return
            }
            pumping = true
            try {
                while (pending.length) {
                    /**
                     * `record` 保证号严格递增，所以排序只是保险；
                     * 真正的价值是：onEvent 重入塞进来的新事件不会插到"还没发的旧事件"前面。
                     */
                    pending.sort((a, b) => a.seq - b.seq)
                    const it = pending.shift()
                    if (seen.has(it.seq)) {
                        continue
                    }
                    seen.add(it.seq)
                    onEvent(it)
                }
            } finally {
                pumping = false
            }
        }

        const cancel = subscribe((it) => {
            /** 一律入队：直接发就会在"补发还没结束"时插队，前端看到倒序帧会当成第二次回答 */
            pending.push(it)
            if (!replaying) {
                pump()
            }
        })

        const result = since(lastSeq)
        if (result.gap) {
            /** gap 时不补发也不直播：半套事件比不续接更危险（前端会把缺的那段当成没发生过） */
            cancel()
            return {cancel, result}
        }
        /** 补发的历史也走同一条队列：与"边补发边到达"的新事件混排后仍是升序 */
        pending.unshift(...result.events)
        replaying = false
        pump()
        return {cancel, result}
    }

    return {
        record,
        since,
        gapBody,
        subscribe,
        replayThenLive,
        close() {
            closed = true
            subs.clear()
        },
        isOpen: () => !closed,
        latest: () => lastSeq,
        size: () => items.length,
        stats: () => ({
            retained: items.length, bytes, evictedThrough, oversized,
            lastSeq, cap, byteCap, closed, messageCode,
        }),
    }
}

export default {createRunEventLog, DEFAULT_MAX_EVENTS, DEFAULT_MAX_BYTES, GAP_CODE}
