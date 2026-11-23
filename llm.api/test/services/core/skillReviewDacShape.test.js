/**
 * @fileOverview 技能审核流转的 dac 形态回归（reviewedBy 置 null 的崩溃哨兵）
 * @module test/services/core/skillReviewDacShape
 * @description
 * 2026-11-16 生产实锤的回归位：ipmi/review 批准时 500
 * `Cannot create field 'realName' in element {reviewedBy: null}`——
 * BaseDac.update 的对象递归展开把 `{reviewedBy: null}` 拆成点路径
 * `$set['reviewedBy.realName']`，而文档现值是 null，mongo 拒绝在 null 上造字段。
 * 判据：凡"整字段置 null 且该字段在 schema 里是对象形"的 patch，必须带
 * `$notRecursion` 哨兵（utils.getSetKeyValue 的逃生门）或改用 $unset 语义。
 * 这里钉 utils 层的两种形态差异——真实端点链路（reviewSkill→dac.update）的
 * 端到端复验在 dev 部署后由 skill-approve 脚本执行。
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import utils from '../../../daos/core/utils.js'

describe('1 对象递归与 $notRecursion 哨兵', () => {
    test('嵌套对象默认展开为点路径（正常局部更新语义）', () => {
        const u = utils.getUpdateSets({operator: {userCode: 'u1', realName: 'R'}}, true)
        assert.equal(u.$set['operator.userCode'], 'u1')
    })
    test('置 null 的正确出口是 $unset；标量 null 与 wrapper 都是错存（2026-11-23 实证钉死，本用例曾以非严格 deepEqual 掩盖真相）', () => {
        // ① 标量 null：notNeedUpdate 跳过 ⇒ $set 里根本没有这个键——"静默没清"不是"清成功"
        const u1 = utils.getUpdateSets({reviewedBy: null}, true)
        assert.equal('reviewedBy' in (u1.$set || {}), false, '标量 null 被跳过（旧底座形态的真相）')
        // ② {value:null} wrapper：存成脏对象（11-16 修复初版的真相）
        const u2 = utils.getUpdateSets({reviewedBy: {$notRecursion: true, value: null}}, true)
        assert.deepEqual(u2.$set.reviewedBy, {value: null}, 'wrapper 原样入库——这就是它被换掉的原因')
        // ③ $unset：唯一真清除
        const u3 = utils.getUpdateSets({reviewedBy: {$unset: true}}, true)
        assert.equal(u3.$unset?.reviewedBy, 1, '$unset 通道必须产出 $unset.reviewedBy=1')
        assert.equal('reviewedBy' in (u3.$set || {}), false, '$unset 形态不得同时出现在 $set')
    })
    test('$notRecursion 逃生门：对象整体替换不展开（approve 写 reviewedBy 对象仍在用）', () => {
        const u = utils.getUpdateSets({reviewedBy: {userCode: 'u', $notRecursion: true}}, true)
        assert.equal(u.$set.reviewedBy.userCode, 'u')
        assert.equal(u.$set['reviewedBy.userCode'], undefined)
    })
})
