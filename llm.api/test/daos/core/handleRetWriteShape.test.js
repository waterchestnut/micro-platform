import {test, describe} from 'node:test'
import * as assert from 'node:assert'

/**
 * §4 幂等写回审计（写层）：updateParentAgentTaskWithLock 的 handleRet 经
 * BaseDac.update → getUpdateSets(attrOpen=true) 落到什么形状的 $set。
 * 这决定"重复完成"的真实语义——**覆盖不叠加，但也不是整键替换**：
 * 对象被展开到叶键（handleRet.a.v），第二轮没带的子键不会被清掉（ghost 子字段）。
 * 把现状钉成显式事实（不是修复方案）：谁改这段写形，这里先红。
 */
const {default: utils} = await import('../../../daos/core/utils.js')

describe('getUpdateSets 对 handleRet 的落库形状（重复完成语义的写层根因）', () => {
    test('对象展开到叶键：$set 里是 handleRet.a.v，不是整对象 handleRet', () => {
        const s = utils.getUpdateSets({handleRet: {a: {v: 1, extra: 2}}}, true).$set
        assert.equal(s['handleRet.a.v'], 1)
        assert.equal(s['handleRet.a.extra'], 2)
        assert.ok(!('handleRet' in s), '整对象 $set 会踩掉其他 child 的键——现状不是这个（也不许改成不假思索的）')
    })
    test('第二轮更小的对象 ⇒ 只覆盖带到的叶键，没带的旧子键在库内**残存**（ghost）——现状显式入账', () => {
        const s1 = utils.getUpdateSets({handleRet: {a: {v: 1, extra: 2}}}, true).$set
        const s2 = utils.getUpdateSets({handleRet: {a: {v: 3}}}, true).$set
        assert.equal(s2['handleRet.a.v'], 3)
        assert.ok(!('handleRet.a.extra' in s2), '第二轮不碰 extra ⇒ 库里 extra 还是 2（不叠加，也不清空）')
        void s1
    })
    test('不同 child 的键互不相干（点路径各写各的）', () => {
        const sA = utils.getUpdateSets({handleRet: {a: {v: 1}}}, true).$set
        const sB = utils.getUpdateSets({handleRet: {b: {v: 2}}}, true).$set
        assert.deepEqual(Object.keys(sA).filter(k => k.startsWith('handleRet')), ['handleRet.a.v'])
        assert.deepEqual(Object.keys(sB).filter(k => k.startsWith('handleRet')), ['handleRet.b.v'])
    })
})
