import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import {
    recoverQueryFromCheckpoints,
    planBackfill,
    backfillAbandonedRuns,
    BACKFILL_MARKER,
} from '../../../../services/core/session/abandonedBackfill.js'
import {DEFAULT_OLDER_THAN_MS} from '../../../../daos/core/policy/llmUsagePolicy.js'

/**
 * 回填的判据与顺序。
 * 这里最要紧的是**顺序**（先认领再写档）与**不碰已有档案**：
 * 前者防重复行污染历史与记忆采集，后者防把真人的数据覆盖成一条机器补的 abort。
 */
const NOW = 1_800_000_000_000
const now = () => NOW
const deadRow = (over = {}) => ({
    messageCode: 'm-1',
    conversationCode: 'c-1',
    userCode: 'u-1',
    progress: 'processing',
    updateTime: new Date(NOW - DEFAULT_OLDER_THAN_MS - 60000),
    modelCalls: 1,
    estPromptTokens: 696,
    ...over,
})
const cpOf = (msgs, seq = 1) => ({seq, phase: 'preCreate', messages: msgs})

describe('recoverQueryFromCheckpoints', () => {
    test('取最后一条 user 消息：这就是"当时问了什么"，5/5 都能救回来', () => {
        const r = recoverQueryFromCheckpoints([
            cpOf([{role: 'system', content: 'sys'}, {role: 'user', content: '帮我写个方案'}]),
            cpOf([{role: 'system', content: 'sys'}, {role: 'user', content: '帮我写个方案'}, {role: 'assistant', content: '半截'}], 2),
        ])
        assert.equal(r.query, '帮我写个方案')
        assert.equal(r.hasAny, true)
    })

    test('空 content 与空白不算问题（避免回填出一条 query 为空气泡）', () => {
        assert.deepEqual(recoverQueryFromCheckpoints([cpOf([{role: 'user', content: '   '}])]),
            {query: '', hasAny: false})
        assert.deepEqual(recoverQueryFromCheckpoints([]), {query: '', hasAny: false})
        assert.deepEqual(recoverQueryFromCheckpoints([{seq: 1, phase: 'preCreate'}]), {query: '', hasAny: false})
    })
})

describe('planBackfill', () => {
    test('已有档案 ⇒ skip，绝不覆盖真人的数据', () => {
        const p = planBackfill({row: deadRow(), hasArchive: true, now})
        assert.equal(p.action, 'skip')
        assert.equal(p.reason, 'archive-exists')
    })

    test('心跳还在阈值内 ⇒ skip（不能把正常在途的 run 判死）', () => {
        const p = planBackfill({row: deadRow({updateTime: new Date(NOW - 1000)}), now})
        assert.equal(p.action, 'skip')
        assert.equal(p.reason, 'heartbeat-fresh')
    })

    test('没有 messageCode ⇒ skip（无法认领也无法幂等）', () => {
        assert.equal(planBackfill({row: deadRow({messageCode: ''}), now}).reason, 'no-message-code')
    })

    test('回填字段：progress=abort、正文为空、原因另存一列、量级未知时写 null 而不是 0', () => {
        const p = planBackfill({row: deadRow(), checkpoint: cpOf([{role: 'user', content: '写个长文'}]), now})
        assert.equal(p.action, 'backfill')
        assert.equal(p.fields.progress, 'abort')
        assert.equal(p.fields.answer, '', '正文一律为空：实测这类 run 正文可救回 0/5，回填不许假装恢复了回答')
        assert.equal(p.fields.query, '写个长文')
        assert.equal(p.fields.extInfo.interruptedBy, 'process-lost')
        assert.equal(p.fields.extInfo.recoveredBy, BACKFILL_MARKER)
        /**
         * 这一条**改写过一次**：原先断言的是 `lostChars === 0`，即把缺陷当成契约钉住。
         * 0 的字面意思是"丢了 0 字"，而回填根本无从知道丢了多少——当时那个 0 只是"没算"的占位，
         * 却会被前端读成"约 0 字未保存"。**测试绿过不代表它钉的是对的行为**，这里就是活例。
         */
        assert.equal(p.fields.extInfo.lostChars, null, '量级未知必须是 null（"不知道"），不许用 0 冒充事实')
        assert.equal(p.fields.extInfo.modelCalls, 1)
        assert.equal(p.fields.extInfo.estPromptTokens, 696)
    })
})

/**
 * @description 造一组假 dac，记录调用顺序
 * @param {Object} o 配置
 * @returns {Object} dacs 与 calls
 */
function fakeDacs({rows = [], existing = null, claimOk = true, addThrows = null, flipReturns = {_id: 'x', progress: 'abort'}} = {}) {
    const calls = []
    return {
        calls,
        dacs: {
            usage: {
                async listAbandoned() {
                    calls.push('listAbandoned')
                    return rows
                },
                async claimAbandoned({messageCode}) {
                    calls.push(`claim:${messageCode}`)
                    return claimOk
                },
            },
            message: {
                async getByCode(code) {
                    calls.push(`getByCode:${code}`)
                    return existing
                },
                async add(info) {
                    calls.push(`add:${info.messageCode}`)
                    if (addThrows) {
                        throw addThrows
                    }
                    return info
                },
                async flipProcessingToAbandoned(code) {
                    calls.push(`flip:${code}`)
                    return flipReturns
                },
            },
            checkpoint: {
                async listByConversation() {
                    return [cpOf([{role: 'user', content: '原始问题'}])]
                },
            },
        },
    }
}

describe('backfillAbandonedRuns 的顺序与幂等', () => {
    test('默认 dryRun：不认领、不写档，只出计划', async () => {
        const {calls, dacs} = fakeDacs({rows: [deadRow()]})
        const r = await backfillAbandonedRuns({now, olderThanMs: DEFAULT_OLDER_THAN_MS, dacs})
        assert.equal(r.reason, 'dry-run')
        assert.equal(r.backfilled.length, 1)
        assert.equal(r.backfilled[0].dryRun, true)
        assert.equal(r.backfilled[0].queryChars, 4)
        assert.ok(!calls.some(c => c.startsWith('claim:')), 'dry-run 绝不能改账本状态')
        assert.ok(!calls.some(c => c.startsWith('add:')), 'dry-run 绝不能写档案')
    })

    test('写模式：先认领成功才写档（顺序反了就会出重复档案）', async () => {
        const {calls, dacs} = fakeDacs({rows: [deadRow()]})
        const r = await backfillAbandonedRuns({dryRun: false, now, olderThanMs: DEFAULT_OLDER_THAN_MS, dacs})
        assert.deepEqual(calls.filter(c => c.startsWith('claim:') || c.startsWith('add:')),
            ['claim:m-1', 'add:m-1'], `必须是先认领后写档，实际 ${calls.join(',')}`)
        assert.equal(r.backfilled[0].dryRun, false)
    })

    test('认领失败（被别人抢先/已终态）⇒ 绝不写档', async () => {
        const {calls, dacs} = fakeDacs({rows: [deadRow()], claimOk: false})
        const r = await backfillAbandonedRuns({dryRun: false, now, olderThanMs: DEFAULT_OLDER_THAN_MS, dacs})
        assert.equal(r.backfilled.length, 0)
        assert.equal(r.skipped[0].reason, 'claim-lost')
        assert.ok(!calls.some(c => c.startsWith('add:')), '没认领到还写档就是重复档案的直接来源')
    })

    test('已有档案的行：既不认领也不写（账本状态必须由它自己的收尾流程改）', async () => {
        const {calls, dacs} = fakeDacs({rows: [deadRow()], existing: {_id: 'x'}})
        const r = await backfillAbandonedRuns({dryRun: false, now, olderThanMs: DEFAULT_OLDER_THAN_MS, dacs})
        assert.equal(r.skipped[0].reason, 'archive-exists')
        assert.ok(!calls.some(c => c.startsWith('claim:')))
        assert.ok(!calls.some(c => c.startsWith('add:')))
    })

    test('认领后写档失败：把 messageCode 与原因留在 skipped 里（这是唯一的人工补救线索）', async () => {
        const {dacs} = fakeDacs({rows: [deadRow()], addThrows: new Error('mongo closed')})
        const r = await backfillAbandonedRuns({dryRun: false, now, olderThanMs: DEFAULT_OLDER_THAN_MS, dacs})
        assert.equal(r.backfilled.length, 0)
        assert.match(r.skipped[0].reason, /claimed-but-write-failed:mongo closed/)
        assert.equal(r.skipped[0].messageCode, 'm-1')
    })
})

/**
 * PR-G 批二b：开局建档后，SIGKILL 留下的形态变了——账本 processing **且** 档案也 processing。
 * 老规则"有档案就 skip"会把这种残留永久留在"进行中"上（前端画着 ongoing，实际进程早没了），
 * 而 add 补一行又违反认领制防重复的初心 ⇒ 新形态=认领后**原地翻转**。
 */
describe('批二b：processing 残留行的翻转（planBackfill）', () => {
    test('档案存在且 progress=processing + 心跳已死 ⇒ flip（不是 add，也不是 skip）', () => {
        const p = planBackfill({row: deadRow(), hasArchive: true, archiveProgress: 'processing', now})
        assert.equal(p.action, 'backfill')
        assert.equal(p.mode, 'flip')
        assert.equal(p.reason, 'processing-row-flip')
        assert.equal(p.fields.progress, 'abort')
        assert.equal(p.fields.error, 'abandoned:process-lost')
        assert.equal(p.fields['extInfo.interruptedBy'], 'process-lost')
        assert.equal(p.fields['extInfo.writtenBy'], 'backfill')
        /** markStarted 写的 query/inputs 是真值且已躺在行里——flip 不许带 query 键去覆盖判断 */
        assert.ok(!('query' in p.fields), 'flip 不重写 query：保留中途行当场写的提问')
        assert.ok(!('answer' in p.fields), 'flip 不动 answer：中途行本来就没写过正文')
    })

    test('安全线：processing 中途行但心跳还新 ⇒ skip heartbeat-fresh——活着的长轮翻不得', () => {
        const p = planBackfill({
            row: deadRow({updateTime: new Date(NOW - 1000)}),
            hasArchive: true, archiveProgress: 'processing', now,
        })
        assert.equal(p.action, 'skip')
        assert.equal(p.reason, 'heartbeat-fresh')
    })

    test('档案是终态（finish/abort/error）⇒ 老规矩 archive-exists 一字不改（真人数据覆盖不得）', () => {
        for (const prog of ['finish', 'abort', 'error']) {
            const p = planBackfill({row: deadRow(), hasArchive: true, archiveProgress: prog, now})
            assert.equal(p.reason, 'archive-exists', `${prog} 行必须维持不动`)
        }
    })

    test('老数据（档案无 progress 字段）⇒ 仍按 archive-exists 走：2b 前的完成行没有这个键，不能被 flip 支误伤', () => {
        const p = planBackfill({row: deadRow(), hasArchive: true, now})
        assert.equal(p.reason, 'archive-exists')
    })
})

describe('批二b：翻转的执行顺序', () => {
    test('flip 支=先认领后翻转，绝不 add（顺序或动词错一个就是重复档案/越权覆盖）', async () => {
        const {calls, dacs} = fakeDacs({rows: [deadRow()], existing: {_id: 'x', progress: 'processing'}})
        const r = await backfillAbandonedRuns({dryRun: false, now, olderThanMs: DEFAULT_OLDER_THAN_MS, dacs})
        assert.deepEqual(calls.filter(c => /^(claim|add|flip):/.test(c)), ['claim:m-1', 'flip:m-1'], `实际 ${calls.join(',')}`)
        assert.equal(r.backfilled[0].mode, 'flip')
    })

    test('认领成功但翻转没抢到（终态恰好落库的 race）⇒ skip flip-missed，**不许**退化成 add', async () => {
        const {calls, dacs} = fakeDacs({
            rows: [deadRow()], existing: {_id: 'x', progress: 'processing'}, flipReturns: null,
        })
        const r = await backfillAbandonedRuns({dryRun: false, now, olderThanMs: DEFAULT_OLDER_THAN_MS, dacs})
        assert.equal(r.skipped[0].reason, 'flip-missed-terminal-race')
        assert.equal(r.backfilled.length, 0)
        assert.ok(!calls.some(c => c.startsWith('add:')), 'race 里补 add 就是同 messageCode 第二行')
    })

    test('dry-run 也带 mode（计划视图要能预先看见"这行会被翻而不是被补"）', async () => {
        const {dacs} = fakeDacs({rows: [deadRow()], existing: {_id: 'x', progress: 'processing'}})
        const r = await backfillAbandonedRuns({now, olderThanMs: DEFAULT_OLDER_THAN_MS, dacs})
        assert.equal(r.backfilled[0].dryRun, true)
        assert.equal(r.backfilled[0].mode, 'flip')
    })
})
