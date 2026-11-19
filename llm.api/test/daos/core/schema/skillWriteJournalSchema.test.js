/**
 * @fileOverview skill 写面幂等账 schema 的离线用例
 * @module test/daos/core/schema/skillWriteJournalSchema.test
 * @description
 * 守三条"错了会静默失效"的口径：
 * ① idempotencyKey 必填+唯一——它是并发终裁的全部资本，可选的唯一索引=想记才记；
 * ② status 默认 started——claim 的行必须从"可能已发生"出生，从 done 出生等于伪造完成；
 * ③ 词表与判据处理面对账——schema 改了词、判据不认识，started 行会被洗成 unknown-status 全拒（或更糟：全放）。
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import {readFileSync} from 'node:fs'
import mongoose from 'mongoose'
import skillWriteJournalSchema from '../../../../daos/core/schema/skillWriteJournalSchema.js'
import {decideSkillWriteGate} from '../../../../services/core/skill/skillWriteIdempotency.js'

const paths = skillWriteJournalSchema.paths || {}
const W = {enabled: true, toolName: 'doc_api/upload', writeTools: ['doc_api/upload'], key: 'm1:t1'}

describe('1 必填与唯一（终裁的地基）', () => {
    test('idempotencyKey 必填：空串/缺失都拒（本表每行都必须有键，无"豁免行"）', () => {
        const M = mongoose.model('T_swj_req', skillWriteJournalSchema)
        assert.ok(new M({}).validateSync()?.errors?.idempotencyKey)
        assert.ok(new M({idempotencyKey: ''}).validateSync()?.errors?.idempotencyKey)
        assert.ok(!new M({idempotencyKey: 'm1:t1'}).validateSync())
    })
    test('idempotencyKey 唯一索引在位（claim 的 create-once 靠它）', () => {
        const idx = skillWriteJournalSchema.indexes().find((x) => x[0].idempotencyKey === 1)
        assert.ok(idx && idx[1].unique === true, '缺唯一索引=并发双 claim 双行，claim 返回旧行的区分失效')
    })
})

describe('2 状态出生与词表（判据 ↔ schema 对账）', () => {
    test('status 默认 started：claim 不许寄望"忘了写就是 done"', () => {
        const M = mongoose.model('T_swj_def', skillWriteJournalSchema)
        assert.equal(new M({idempotencyKey: 'k'}).toObject().status, 'started')
    })
    test('词表外状态被 enum 拒（写坏在门口，不等到判据 refuse 才发现）', () => {
        const M = mongoose.model('T_swj_enum', skillWriteJournalSchema)
        assert.ok(new M({idempotencyKey: 'k', status: 'DONE'}).validateSync()?.errors?.status)
    })
    test('词表集合 = 判据认识的两种状态（done 走 replay、started 走 refuse；多一个都算漂移）', () => {
        assert.deepEqual([...paths.status.enumValues].sort(), ['done', 'started'])
        assert.deepEqual(skillWriteJournalSchema.STATUSES, ['started', 'done'])
        assert.equal(decideSkillWriteGate({...W, existing: {status: 'done', resultSnapshot: ''}}).action, 'replay')
        assert.equal(decideSkillWriteGate({...W, existing: {status: 'started'}}).action, 'refuse')
    })
    test('快照默认空串+truncated=false（started 行没资格携带内容）', () => {
        const M = mongoose.model('T_swj_snap', skillWriteJournalSchema)
        const o = new M({idempotencyKey: 'k'}).toObject()
        assert.equal(o.resultSnapshot, '')
        assert.equal(o.snapshotTruncated, false)
    })
})

describe('3 离线可载（顶层不碰 llm）', () => {
    test('schema 源文件无 llm 顶层引用（journalCode default 引 llm.tools 的那版会在 node --test 里 ReferenceError）', () => {
        const src = readFileSync(new URL('../../../../daos/core/schema/skillWriteJournalSchema.js', import.meta.url), 'utf8')
        const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
        assert.ok(!/\bllm\./.test(code), 'schema 顶层出现 llm 引用=离线测试必炸')
    })
})
