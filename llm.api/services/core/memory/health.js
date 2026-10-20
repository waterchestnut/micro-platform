/**
 * @fileOverview 抽取消费者健康探针（PR-3b 交付物：lag 指标 + 健康检查）
 * @module services/core/memory/health
 * @description §6.3 说过未部署消费者的后果极其隐蔽："capture 持续堆积、记忆永远不生效、
 * 而聊天一切正常没人发现"。所以健康判定必须独立于聊天路径可查，且**每个结论都是计数**：
 *   - 消费者心跳：进程每 30s 写 redis，超过 beatMaxAgeS 视为死（不是"进程在=健康"）；
 *   - 消费组：describeGroups 的 state 与成员分配分区（Map 序列化成对象后也能读）；
 *   - lag：listOffsets(end) - listConsumerGroupOffsets(committed)，按分区算、给总数。
 * Admin/redis 注入式：纯判定（verdictOf/partitionLags）可脱网单测。
 * @author xianyang
 */

const BEAT_KEY = 'mem:cons:beat:memoryExtractor'

/** bigint 在 JSON 里会炸；出口一律 Number */
function num(v) {
    if (typeof v === 'bigint') return Number(v)
    const n = Number(v)
    return Number.isFinite(n) ? n : null
}

function mapToObj(x) {
    if (x instanceof Map) {
        const o = {}
        for (const [k, v] of x) o[k] = mapToObj(v)
        return o
    }
    if (x && typeof x === 'object' && !Array.isArray(x)) {
        const o = {}
        for (const [k, v] of Object.entries(x)) o[k] = mapToObj(v)
        return o
    }
    if (Array.isArray(x)) return x.map(mapToObj)
    return x
}

/**
 * @description 分区级 lag：end - committed，缺 committed 按 0（全新组从 EARLIEST 起算）
 * @author xianyang
 * @param {Object[]} endOffsets listOffsets 结果（{name, partitions:[{partitionIndex, offset}]}）
 * @param {Object[]} committedGroups listConsumerGroupOffsets 结果
 * @param {String} topic 主题名
 * @returns {Object[]} [{partition, end, committed, lag}]
 */
export function partitionLags(endOffsets, committedGroups, topic) {
    const endTopic = (endOffsets || []).find(t => t?.name === topic)
    const ends = new Map((endTopic?.partitions || []).map(p => [Number(p.partitionIndex), num(p.offset)]))
    const g = (committedGroups || []).find(x => x?.groupId)
    const comTopic = ((g?.topics || []).find(t => t?.name === topic)?.partitions || [])
    const coms = new Map(comTopic.map(p => [Number(p.partitionIndex ?? p.partition), num(p.committedOffset)]))
    const parts = [...new Set([...ends.keys(), ...coms.keys()])].sort((a, b) => a - b)
    return parts.map(pi => {
        const end = ends.get(pi)
        const committed = coms.has(pi) ? coms.get(pi) : 0
        const lag = end != null && committed != null ? Math.max(0, end - committed) : null
        return {partition: pi, end, committed, lag}
    })
}

/**
 * @description 健康判定（纯函数，规则表驱动，每条 FAIL 带可行动原因）
 * @author xianyang
 * @param {Object} facts {beat, consumerAlive, groupState, members, lags, thresholds}
 * @returns {Object} {verdict, reasons, totalLag}
 */
export function verdictOf(facts = {}) {
    const th = facts.thresholds || {}
    const lagWarn = Number(th.lagWarn ?? 1000)
    const reasons = []
    if (!facts.consumerAlive) {
        reasons.push(`消费者心跳缺失或超龄（>${th.beatMaxAgeS ?? 90}s）—— 进程没跑或连不上 redis，记忆抽取会静默堆积`)
    }
    if (facts.beat && facts.beat.dlq) {
        reasons.push(`心跳里累计死信 ${facts.beat.dlq} 条，需查死信主题`)
    }
    const state = String(facts.groupState || '')
    if (facts.groupError) reasons.push(`describeGroups 失败：${facts.groupError}`)
    else if (!state) reasons.push('消费组不存在（从未有消费者连过？）')
    /** dev 实测：broker 返回 STABLE/EMPTY 大写，比较一律归一小写 */
    else if (state.toLowerCase() !== 'stable') reasons.push(`消费组状态 ${state}（非 Stable）`)
    if (!facts.members) reasons.push('消费组成员数 0（无进程在消费）')
    const lags = facts.lags || []
    const totalLag = lags.reduce((s, l) => s + (l.lag ?? 0), 0)
    if (!lags.length) reasons.push('拿不到分区 lag（组为空/未分配分区或元数据读取失败——若同时有成员=0，多半是消费者都下线了）')
    if (totalLag > lagWarn) reasons.push(`累计 lag=${totalLag} 超阈值 ${lagWarn}`)
    return {verdict: reasons.length ? (lags.length || state ? 'WARN' : 'DOWN') : 'OK', reasons, totalLag}
}

/**
 * @description 汇总一次探针（admin/redis 可注入，便于测试与复用）
 * @author xianyang
 * @param {Object} [opts] {admin, redis, topic, groupId, thresholds}
 * @returns {Promise<Object>} 报告
 */
export async function getExtractorHealth(opts = {}) {
    const config = llm.config
    const topicCfg = config.kafka?.topics?.memoryExtract || {}
    const topic = opts.topic || topicCfg.topic
    const groupId = opts.groupId || topicCfg.groupId || `${topic}-group`
    const thresholds = {beatMaxAgeS: 90, lagWarn: 1000, ...(opts.thresholds || {})}

    let redis = opts.redis
    if (!redis) redis = (await import('../../../daos/cache/redisClient.js')).default
    let admin = opts.admin
    let shouldCloseAdmin = false
    if (!admin) {
        const {createClient} = await import('../../../daos/kafka/client.js')
        const {Admin} = await import('@platformatic/kafka')
        admin = new Admin(createClient('memory-health-probe'))
        shouldCloseAdmin = true
    }

    let beat = null
    try {
        const raw = await redis.getValue(BEAT_KEY)
        beat = raw ? JSON.parse(String(raw)) : null
    } catch { /* 视同无心跳 */ }
    const consumerAlive = !!(beat?.at && (Date.now() - beat.at) < thresholds.beatMaxAgeS * 1000)

    let groupState = ''
    let members = 0
    let assignedPartitions = null
    let groupError = ''
    try {
        const dg = await admin.describeGroups({groups: [groupId]})
        const g = dg instanceof Map ? dg.get(groupId) : dg?.[groupId]
        if (g) {
            groupState = String(g.state || '')
            const ms = g.members instanceof Map ? [...g.members.values()] : (g.members || [])
            members = ms.length
            for (const m of ms) {
                const as = m.assignments
                const entries = as instanceof Map ? [...as.entries()] : Object.entries(as || {})
                for (const [t, v] of entries) {
                    if (String(t) !== String(topic)) continue
                    const pa = Array.isArray(v) ? v : (v?.partitions ?? v?.partitionIds ?? [])
                    if (pa.length) assignedPartitions = pa.map(p => Number(p?.partitionIndex ?? p))
                }
            }
        }
    } catch (e) {
        groupError = String(e.message).slice(0, 120)
    }

    let lags = []
    try {
        if (topic) {
            /** 分区集合优先取成员分配；组不存在时探测 0..7（超出的分区在 listOffsets 里报错→整体降级为空，不误判） */
            const parts = (assignedPartitions && assignedPartitions.length ? assignedPartitions : [0, 1, 2, 3, 4, 5, 6, 7])
            const end = await admin.listOffsets({
                topics: [{name: topic, partitions: parts.map(p => ({partitionIndex: p, timestamp: -1n}))}],
                isolationLevel: 1,
            })
            const com = await admin.listConsumerGroupOffsets({groups: [groupId]})
            lags = partitionLags(end, com, topic)
        }
    } catch { lags = [] }

    const v = verdictOf({beat, consumerAlive, groupState, groupError, members, lags, thresholds})
    if (shouldCloseAdmin) { try { await admin.close() } catch { /* 探针收尾不抛 */ } }

    return mapToObj({
        topic, groupId,
        consumer: {alive: consumerAlive, beat: beat ? {at: beat.at, ageS: Math.round((Date.now() - beat.at) / 1000), instanceTag: beat.instanceTag, counts: beat.counts} : null},
        group: {state: groupState, members, assignedPartitions, error: groupError},
        lags,
        verdict: v.verdict, reasons: v.reasons, totalLag: v.totalLag, thresholds,
    })
}

export const HEARTBEAT_KEY = BEAT_KEY
export const HEARTBEAT_TTL_S = 90
export const HEARTBEAT_INTERVAL_MS = 30000

/**
 * @description 消费者进程侧心跳：30s 一跳，写 pid/累计计数；失败只告警——心跳挂≠消费挂，
 * 但反过来"心跳死"一定会把探针打成 WARN，这正是我们要的可观测性。
 * @author xianyang
 * @param {Object} [opts] {redis, instanceTag, getCounts}
 * @returns {Function} stop
 */
export function startHeartbeat(opts = {}) {
    const logger = (typeof llm !== 'undefined' && llm.logger) ? llm.logger : console
    const redis = opts.redis
    const instanceTag = opts.instanceTag || ''
    const getCounts = opts.getCounts || (() => ({}))
    let stopped = false
    const beat = async () => {
        if (stopped) return
        try {
            await redis.setValue(BEAT_KEY, JSON.stringify({
                at: Date.now(), pid: process.pid, instanceTag, counts: getCounts(),
            }), HEARTBEAT_TTL_S)
        } catch (e) {
            logger.warn(`memoryExtractor 心跳写入失败：${e.message}`)
        }
    }
    beat()
    const timer = setInterval(beat, HEARTBEAT_INTERVAL_MS)
    if (typeof timer.unref === 'function') timer.unref()
    return () => { stopped = true; clearInterval(timer) }
}

export default {getExtractorHealth, partitionLags, verdictOf, startHeartbeat, HEARTBEAT_KEY}
