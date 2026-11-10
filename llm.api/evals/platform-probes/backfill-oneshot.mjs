/**
 * @fileOverview 遗弃 run 回填的一次性执行器（plan / write / audit 三段）
 * @module evals/platform-probes/backfill-oneshot
 * @description
 * 存在的理由：回填这条写路径**从来没有真跑过**，而 `writtenBy` 的落库值也缺一条真跑断言（§25 记着这个覆盖缺口）。
 * 默认状态是"只出计划"，两道开关都在配置里关着 ⇒ 想验证一次就得有一个人工入口，
 * 但那个人工入口本身不能变成第三个误操作点，所以：
 * **`--phase=write` 必须同时给 `--confirm=WRITE`，否则拒绝执行并按只读出计划。**
 *
 * 三段：
 * - `plan`  只读，列候选与拟写内容（等价于 dryRun）
 * - `write` 真写库（先 claim 再写档，幂等靠认领）
 * - `audit` 只读复核：`extInfo.writtenBy` / `recoveredBy` 的**落库值**与 llmUsage 终态
 *
 * 用法（在 pod 里跑，配置与凭据由环境给，脚本里没有任何明文秘钥）：
 *   node evals/platform-probes/backfill-oneshot.mjs --phase=plan
 *   node evals/platform-probes/backfill-oneshot.mjs --phase=write --confirm=WRITE
 *   node evals/platform-probes/backfill-oneshot.mjs --phase=audit
 */
import fs from 'node:fs'

const argv = process.argv.slice(2)
const val = (n, d) => {
    const hit = argv.find(a => a.startsWith(`--${n}=`))
    return hit ? hit.slice(n.length + 3) : d
}
const PHASE = val('phase', 'plan')
const CONFIRM = val('confirm', '')
const OUT = val('out', '')
const LINES = []
/**
 * @description 自己落文件再打印（中文键名不走 PowerShell 重定向）
 * @param {String} note 事件
 * @param {Object} obj 字段
 */
function log(note, obj = {}) {
    const line = JSON.stringify({probe: 'backfill-oneshot', phase: PHASE, note, ...obj})
    LINES.push(line)
    console.log(line)
    if (OUT) {
        fs.writeFileSync(OUT, LINES.join('\n') + '\n')
    }
}

await import('../../init.js')
const {runBackfill} = await import('../../tasks/abandonedBackfill.js')

if (PHASE === 'write' && CONFIRM !== 'WRITE') {
    log('拒绝写库', {原因: '缺 --confirm=WRITE；降级为只读出计划', 降级: true})
}

const forcePlan = PHASE === 'write' && CONFIRM === 'WRITE'
const ret = await runBackfill(forcePlan ? {dryRun: false, force: true} : {})
log('执行结果', {
    模式: forcePlan ? 'WRITE' : 'plan',
    扫到: ret.planned,
    回填条数: (ret.backfilled || []).length,
    跳过: (ret.skipped || []).length,
    跳过原因: (ret.skipped || []).map(x => x.reason || x).slice(0, 5),
    样例: (ret.backfilled || []).slice(0, 3),
    原始reason: ret.reason,
})

if (PHASE === 'audit') {
    /**
     * 读自己的库用 app 现成的模型，不另开 MongoClient：
     * `mongodb` 不是本项目的直接依赖（只有 mongoose），上一版在这里 `import {MongoClient}` 直接 ERR_MODULE_NOT_FOUND。
     * 顺手也证明了"审计走的是应用同一套连接与 schema"，而不是我另接一条只看得到的通道。
     */
    const {Message, LlmUsage} = await import('../../daos/core/schema/index.js')
    const rows = await Message.find(
        {'extInfo.recoveredBy': 'abandoned-backfill'},
        {messageCode: 1, progress: 1, 'extInfo.writtenBy': 1, 'extInfo.interruptedBy': 1, answer: 1, query: 1},
    ).lean()
    const byField = rows.reduce((a, r) => {
        const k = r.extInfo?.writtenBy ?? '(无字段)'
        a[k] = (a[k] || 0) + 1
        return a
    }, {})
    const codes = rows.map(r => r.messageCode).filter(Boolean)
    const usage = codes.length ? await LlmUsage.find({messageCode: {$in: codes}}, {messageCode: 1, progress: 1}).lean() : []
    const usageProgress = usage.reduce((a, u) => {
        a[u.progress ?? '(无)'] = (a[u.progress ?? '(无)'] || 0) + 1
        return a
    }, {})
    log('落库复核', {
        库: llm.config.mongodbConfig.options.dbName,
        回填档案行数: rows.length,
        writtenBy分布: byField,
        正文长度分布: rows.reduce((a, r) => {
            const n = (r.answer || '').length
            a[n > 0 ? '有正文' : '空正文'] = (a[n > 0 ? '有正文' : '空正文'] || 0) + 1
            return a
        }, {}),
        问题文本非空行数: rows.filter(r => (r.query || '').length > 0).length,
        对应账本终态: usageProgress,
    })
    /**
     * 判据：这条路径要是没被真跑过，下面这几条就是"我以为它工作"的那类信念。
     * writtenBy 必须是 backfill（不是 unattributed/normal），否则事后分不清谁写的档。
     */
    const checks = [
        {判据: '有行被写出', 通过: rows.length > 0, 读数: rows.length},
        {判据: '全部标 writtenBy=backfill', 通过: rows.length > 0 && Object.keys(byField).length === 1 && byField.backfill === rows.length, 读数: byField},
        {判据: '问题文本都捞回来了', 通过: rows.every(r => (r.query || '').length > 0), 读数: rows.filter(r => !(r.query || '').length).length + ' 条空'},
        {判据: '账本不再停在 processing', 通过: !('processing' in usageProgress), 读数: usageProgress},
    ]
    log('判定', {全部通过: checks.every(c => c.通过), checks})
    await mongooseDisconnect()
    process.exit(checks.every(c => c.通过) ? 0 : 1)
}
process.exit(0)

/**
 * @description 释放 mongoose 连接，让进程能自然退出（不靠 process.exit 掩盖残留句柄）
 * @returns {Promise<void>} 结果
 */
async function mongooseDisconnect() {
    try {
        const mongoose = (await import('mongoose')).default
        await mongoose.disconnect()
    } catch (e) {
        /* 断开失败不影响审计结论 */
    }
}
