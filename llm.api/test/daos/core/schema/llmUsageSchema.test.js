import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import mongoose from 'mongoose'
import llmUsageSchema from '../../../../daos/core/schema/llmUsageSchema.js'

/**
 * 账本列口径。
 *
 * 这里守的是一条**已经被实测咬过**的规则：估算值与上游实测值必须分列。
 * 2026-11-10 的读数：三条被掐断的 run 真实生成了 10,772 + 1,986 字，
 * 而账本里 `completionTokens` 合计 1 —— 因为 usage 帧在流末尾，断开就永远收不到。
 * 如果当时把估算值直接写进 `completionTokens`，报表会"好看"，但那列从此不可信；
 * 所以走 `estCompletionTokens` 独立成列（同 `estPromptTokens` 的既定规矩）。
 */
const paths = llmUsageSchema.paths || {}

describe('llmUsageSchema 的估算列', () => {
    test('estCompletionTokens 存在、是 Number、默认 0', () => {
        const p = paths.estCompletionTokens
        assert.ok(p, '必须显式声明：mongoose 的严格模式会把没声明的字段**静默丢掉**，'
            + '那正好是"写了不落库"最难查的形态')
        assert.equal(p.instance, 'Number')
        assert.equal(p.defaultValue, 0, '默认必须是 0：聚合时 undefined 会变成"这行没数据"，与"生成了 0 字"混淆')
    })

    test('estPromptTokens 与 estCompletionTokens 都在，且与实测列是**不同的路径**', () => {
        assert.ok(paths.estPromptTokens, '在途刷新写的估算输入列')
        assert.ok(paths.estCompletionTokens, '断档行唯一的输出量级来源')
        assert.notEqual(paths.estCompletionTokens, paths.completionTokens)
        assert.notEqual(paths.estPromptTokens, paths.billablePromptTokens)
    })

    test('实测列不许被估算值顶替：写一条只有估算的行，实测列仍是 0', () => {
        const M = mongoose.model('T_llmUsage_cols', llmUsageSchema)
        const doc = new M({
            messageCode: 'm-1',
            conversationCode: 'c-1',
            estPromptTokens: 696,
            estCompletionTokens: 1400,
        })
        const o = doc.toObject()
        assert.equal(o.estPromptTokens, 696)
        assert.equal(o.estCompletionTokens, 1400)
        assert.equal(o.promptTokens, 0, '上游实测列必须保持 0：把估算塞进去，这列就再也不能用于对账')
        assert.equal(o.completionTokens, 0)
        assert.equal(o.billablePromptTokens, 0)
        assert.equal(o.hasUsage, false, '"没量到"与"量为 0"必须是两种状态（D42）')
    })

    test('没声明的字段不会静默入库（严格模式），所以新增列必须改这里', () => {
        const M = mongoose.model('T_llmUsage_strict', llmUsageSchema)
        const doc = new M({messageCode: 'm-2', someFutureColumn: 1})
        assert.equal(doc.toObject().someFutureColumn, undefined,
            '严格模式下未知列被丢弃 ⇒ 加列要同时改 schema 与写入点，只改一边就是白写')
    })
})
