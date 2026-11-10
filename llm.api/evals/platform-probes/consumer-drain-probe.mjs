/**
 * @fileOverview 停机排空的现场验证：用一次性主题 + 一次性消费组，把"SIGTERM 之后到底等不等在途"变成可读时间线
 * @module evals/platform-probes/consumer-drain-probe
 * @description
 * 为什么需要它（以及前面两次尝试为什么都不算证据）：
 * 1. 读 `app.log` 找不到排空那行 —— 不是没跑，是那个文件**在新进程启动时被截断**，
 *    停机时刻写的行已经被覆盖。拿"会被重启吃掉的日志"当验收依据，判据本身就不成立。
 * 2. 读消费组成员数也分不出来 —— "干净 leave group" 与 "进程直接死掉" 都会让组停在
 *    `PREPARING_REBALANCE` 约 27s（实测），这个数字几乎等于 `sessionTimeout=30000`，两种解释都容得下它。
 * 3. 第一版判据把 `committed` 硬编码成 1，跑出来是 37022：**不是行为错，是断言错** ——
 *    共享主题上新组从 `LATEST` 起消，起点根本不由我定。
 *    ⇒ 所以这里改成**探针自建一次性主题**（1 分区、空主题、跑完删除）：位点从 0 起，
 *      `committed === 1` 是无歧义的读法，也不用担心把别的主题的存量拉下来。
 *
 * 时间线用 `fs.appendFileSync` 直接写盘，**不经 pino、不经 pm2** ——
 * 本探针要验的正是"退出会不会吃掉在途"，不能再用一条可能被吃掉的日志当尺子。
 *
 * 判据（全部由时间线与 Admin 读数计算）：
 * - `HANDLER_DONE` 晚于 `SELF_SIGTERM` ⇒ 停机**真的等**了在途那条
 * - `PROCESS_EXIT` 不早于 `HANDLER_DONE` ⇒ 等完才退
 * - 探针组 `committed === 1` ⇒ 位点是那个正在退出的进程提交的 ⇒ **不会被重跑**
 * - `HANDLER_START` 只出现 1 次（一共投了 2 条） ⇒ 排空期间**没接新活**
 *
 * 用法：
 *   在 pod 里跑：node /app/evals/platform-probes/consumer-drain-probe.mjs --phase=serve --state=/tmp/dp.json
 *   本地跑判据：node evals/platform-probes/consumer-drain-probe.mjs --phase=verify --state=<取回的 dp.json>
 *   （`--keep=true` 可以留着主题与组复查；默认 verify 结束会删组与删主题）
 */
import fs from 'node:fs'
import {Admin} from '@platformatic/kafka'

const argv = process.argv.slice(2)
const val = (n, d) => {
    const hit = argv.find(a => a.startsWith(`--${n}=`))
    return hit ? hit.slice(n.length + 3) : d
}
const PHASE = val('phase', 'serve')
const STAMP = Date.now()
/** 状态文件里放 topic / group / 时间线路径：serve 与 verify 之间只靠它传参，不靠记忆 */
const STATE = val('state', `/tmp/drain-probe-${STAMP}.json`)
const SLEEP_MS = Number(val('sleepMs', 12000))
const SIGTERM_AT_MS = Number(val('sigtermAtMs', 3000))
const PROBE_ID = val('probeId', String(STAMP))
const TOPIC = val('topic', '') || `xxzx-drain-probe-${PROBE_ID}`
const GROUP = val('group', '') || `xxzx-drain-probe-${PROBE_ID}`

const config = (await import('../../conf/system.config.js')).default
const kafka = config.kafka
const admin = new Admin({
    clientId: `${kafka.clientId}-drain-probe`,
    bootstrapBrokers: kafka.brokers,
    ...kafka.retry,
    sasl: kafka.sasl,
})

const readState = () => JSON.parse(fs.readFileSync(STATE, 'utf8'))
/**
 * @description 同步写一行时间线（不用 logger：那正是本探针要检验的东西之一）
 * @param {String} truth 文件
 * @param {String} evt 事件
 * @param {String} [extra] 字段
 */
function mark (truth, evt, extra = '') {
    const line = `${new Date().toISOString()} pid=${process.pid} ${evt}${extra ? ' ' + extra : ''}\n`
    fs.appendFileSync(truth, line)
    process.stdout.write(line)
}

if (PHASE === 'serve') {
    const truth = val('truth', `/tmp/drain-probe-${PROBE_ID}.log`)
    fs.writeFileSync(truth, '')
    fs.writeFileSync(STATE, JSON.stringify({topic: TOPIC, group: GROUP, truth, stamp: STAMP}))
    mark(truth, 'PROBE_START', `topic=${TOPIC} group=${GROUP} sleepMs=${SLEEP_MS} sigtermAtMs=${SIGTERM_AT_MS}`)
    /** 空主题 + 1 分区：位点从 0 开始，判据才能写成 committed === 1 */
    await admin.createTopics({topics: [TOPIC], partitions: 1, replicas: 1})
    mark(truth, 'TOPIC_CREATED')

    /** 消费者相关模块必须在 init 之后动态取（`llm` 全局在 init 里立） */
    await import('../../init.js')
    const {subscribe, sendMessage, createClient} = await import('../../daos/kafka/client.js')
    const {MessagesStreamModes, MessagesStreamFallbackModes} = await import('@platformatic/kafka')
    const client = createClient('drainProbe')
    let handlerCount = 0
    await subscribe([TOPIC], GROUP, async ({partition}) => {
        handlerCount += 1
        mark(truth, 'HANDLER_START', `n=${handlerCount} partition=${partition}`)
        /** 故意慢：这一段就是"在途"，停机该不该等它，全看后面的时间线 */
        await new Promise(r => setTimeout(r, SLEEP_MS))
        mark(truth, 'HANDLER_DONE', `n=${handlerCount} partition=${partition}`)
        return 'done'
    }, client, {mode: MessagesStreamModes.COMMITTED, fallbackMode: MessagesStreamFallbackModes.EARLIEST})
    mark(truth, 'SUBSCRIBED')
    await new Promise(r => setTimeout(r, 2000))
    await sendMessage([{topic: TOPIC, key: 'p1', value: JSON.stringify({probe: 1})}], client)
    mark(truth, 'PRODUCED_1')
    await sendMessage([{topic: TOPIC, key: 'p2', value: JSON.stringify({probe: 2})}], client)
    mark(truth, 'PRODUCED_2')

    setTimeout(() => {
        mark(truth, 'SELF_SIGTERM', `handlerCount=${handlerCount}`)
        process.kill(process.pid, 'SIGTERM')
    }, SIGTERM_AT_MS)
    process.on('exit', (code) => {
        try {
            mark(truth, 'PROCESS_EXIT', `code=${code} handlerCount=${handlerCount}`)
        } catch (e) {
            /* 退出路径里写不出去，也只是少一行，不能再抛 */
        }
    })
    setInterval(() => {}, 1000)
} else if (PHASE === 'verify') {
    const st = readState()
    const text = fs.readFileSync(st.truth, 'utf8')
    /**
     * @description 取某事件最后一次出现的时间戳
     * @param {String} evt 事件名
     * @returns {Number|null} ms
     */
    const tsOf = (evt) => {
        const hits = text.split(/\r?\n/).filter(l => l.includes(` ${evt} `) || l.endsWith(` ${evt}`))
        return hits.length ? Date.parse(hits[hits.length - 1].slice(0, 24)) : null
    }
    /**
     * @description 探针组的已提交位点合计（新主题只有 1 个分区，求和即该分区的值）
     * @returns {Promise<Number|String>} 位点或失败说明
     */
    const committedOf = async () => {
        try {
            const o = await admin.listConsumerGroupOffsets({groups: [st.group]})
            let sum = 0
            let found = false
            for (const g of o || []) {
                for (const t of g.topics || []) {
                    for (const p of t.partitions || []) {
                        sum += Number(p.committedOffset)
                        found = true
                    }
                }
            }
            return found ? sum : '无已提交位点'
        } catch (e) {
            return `读取失败: ${e?.message || e}`
        }
    }
    const committed = await committedOf()
    const tSig = tsOf('SELF_SIGTERM')
    const tDone = tsOf('HANDLER_DONE')
    const tExit = tsOf('PROCESS_EXIT')
    const starts = (text.match(/HANDLER_START/g) || []).length
    const checks = [
        {判据: '在途被等完（HANDLER_DONE 晚于 SELF_SIGTERM）', 通过: tSig !== null && tDone !== null && tDone >= tSig, 读数: `差=${tDone !== null && tSig !== null ? tDone - tSig : '-'}ms`},
        {判据: '等完才退出（PROCESS_EXIT 不早于 HANDLER_DONE）', 通过: tDone !== null && tExit !== null && tExit >= tDone, 读数: `done→exit=${tExit !== null && tDone !== null ? tExit - tDone : '-'}ms`},
        {判据: '位点由退出中的进程提交（空主题消费 1 条 ⇒ committed=1 ⇒ 不会被重跑）', 通过: committed === 1, 读数: `committed=${committed}`},
        {判据: '排空期间没接新活（投 2 条只处理 1 条）', 通过: starts === 1, 读数: `HANDLER_START=${starts}`},
    ]
    const verdict = checks.every(c => c.通过)
    console.log(JSON.stringify({主题: st.topic, 组: st.group, 时间线: text.trim().split(/\r?\n/), 判据: checks, 全部通过: verdict}, null, 1))
    if (val('keep', 'false') !== 'true') {
        const cleaned = []
        try {
            await admin.deleteGroups({groups: [st.group]})
            cleaned.push(`已删组 ${st.group}`)
        } catch (e) {
            cleaned.push(`删组失败: ${e?.message || e}`)
        }
        try {
            await admin.deleteTopics({topics: [st.topic]})
            cleaned.push(`已删主题 ${st.topic}`)
        } catch (e) {
            cleaned.push(`删主题失败: ${e?.message || e}`)
        }
        console.log(JSON.stringify({清理: cleaned}))
    }
    await admin.close()
    /**
     * 判据未过要让人看见（exit 1），但不能让调用方把 stdout 丢掉：
     * 上一版就是 execFileSync 在非 0 退出时抛异常，读数全埋在异常对象里。
     */
    process.exit(verdict ? 0 : 1)
} else {
    console.log('未知 phase，支持 serve / verify')
    process.exit(2)
}
