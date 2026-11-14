/**
 * @fileOverview artifact 登记账本 schema 的离线用例
 * @module test/daos/core/schema/artifactSchema
 * @description
 * 守三条"错了会污染账本且难回头"的口径：
 * ① state 词表必须与 artifactReconcile.INTAKE_STATE **集合相等**——daos 层刻意不 import services（防分层倒挂），
 *    对齐靠这里的断言钉住：任何一边改词，这条先红，而不是到线上对账时才"这个词不认识"；
 * ② integrity 默认 unknown——**没核验过不等于好**（与孤儿判据"未知不当缺/不当在"同一纪律）；
 * ③ idempotencyKey 的 sparse 唯一豁免依赖**字段缺失**而非空串——校验器拒 ''，否则第二条无键登记会撞墙。
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import mongoose from 'mongoose'
import artifactSchema from '../../../../daos/core/schema/artifactSchema.js'
import {INTAKE_STATE} from '../../../../services/core/artifact/artifactReconcile.js'

const paths = artifactSchema.paths || {}

describe('1 跨层词表对账（schema ↔ artifactReconcile）', () => {
    test('state 枚举与 INTAKE_STATE 集合相等（漂移即红，不留到线上对账才认不出词）', () => {
        const fromSchema = [...paths.state.enumValues].sort()
        const fromReconcile = Object.values(INTAKE_STATE).map(String).sort()
        assert.deepEqual(fromSchema, fromReconcile,
            `daos 的 state 词表与 services 判据词表漂移了：${JSON.stringify({fromSchema, fromReconcile})}`)
    })
})

describe('2 必填与默认（登记时刻的口径）', () => {
    test('artifactCode 必填：没有标识的登记不许存在', () => {
        const M = mongoose.model('T_artifact_req', artifactSchema)
        const err = new M({conversationCode: 'c1'}).validateSync()
        assert.ok(err && err.errors && err.errors.artifactCode, '缺 artifactCode 必须校验失败')
        assert.ok(!new M({artifactCode: 'a-1'}).validateSync(), '给了就过')
    })
    test('state 默认 registered：这行诞生于 §9.5 第 3 步"登记"；version 默认 1', () => {
        const M = mongoose.model('T_artifact_def', artifactSchema)
        const o = new M({artifactCode: 'a-1'}).toObject()
        assert.equal(o.state, 'registered')
        assert.equal(o.version, 1)
        assert.equal(o.sizeBytes, 0, '默认 0（没量到）与 undefined 区分：聚合不把整行当缺数据')
    })
    test('非法 state/integrity 被拒（词表不是装饰）', () => {
        const M = mongoose.model('T_artifact_enum', artifactSchema)
        assert.ok(new M({artifactCode: 'a', state: 'half-done'}).validateSync())
        assert.ok(new M({artifactCode: 'a', integrity: 'fine'}).validateSync())
    })
    test('integrity 默认 unknown：未核验过**不许**默认 ok', () => {
        const M = mongoose.model('T_artifact_int', artifactSchema)
        assert.equal(new M({artifactCode: 'a'}).toObject().integrity, 'unknown')
    })
})

describe('3 幂等键的 sparse 语义（§9 line 762 的落库形态）', () => {
    test('缺失豁免（undefined 过）；空串被拒（sparse 只豁免缺失，写 "" 会让第二条无键登记撞唯一索引）', () => {
        const M = mongoose.model('T_artifact_idem', artifactSchema)
        assert.ok(!new M({artifactCode: 'a'}).validateSync(), '不给键 ⇒ 过')
        const err = new M({artifactCode: 'a', idempotencyKey: ''}).validateSync()
        assert.ok(err && err.errors && err.errors.idempotencyKey, '空串必须被拒')
        assert.ok(!new M({artifactCode: 'a', idempotencyKey: 'run1:call2'}).validateSync(), '正常键过')
    })
    test('唯一索引齐备：artifactCode 唯一 + idempotencyKey 唯一 sparse', () => {
        const idx = artifactSchema.indexes()
        const byCode = idx.find((x) => x[0].artifactCode === 1)
        const byKey = idx.find((x) => x[0].idempotencyKey === 1)
        assert.ok(byCode && byCode[1].unique, '一行一版本')
        assert.ok(byKey && byKey[1].unique && byKey[1].sparse, '重放不许多行，且缺失豁免')
    })
})

describe('4 版本链与作者（§5 line 470 跨人链的字段承载）', () => {
    test('链三件套 + 行级作者都在：版本历史要逐行显示"谁改的"', () => {
        for (const k of ['parentArtifactCode', 'lineageRootArtifactCode', 'version', 'userCode']) {
            assert.ok(paths[k], `${k} 必须显式声明（严格模式丢没声明的列）`)
        }
    })
    test('对账要用的列都在：fileCode/sizeBytes/sha256/state/messageCode', () => {
        for (const k of ['fileCode', 'sizeBytes', 'sha256', 'state', 'messageCode', 'sandboxId', 'sourcePath']) {
            assert.ok(paths[k], `${k} 必须显式声明`)
        }
    })
    test('未知列不静默入库（加列必须同时改 schema 与写入点）', () => {
        const M = mongoose.model('T_artifact_strict', artifactSchema)
        const doc = new M({artifactCode: 'a', someFutureColumn: 1})
        assert.equal(doc.toObject().someFutureColumn, undefined)
    })
})
