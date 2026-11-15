/**
 * @fileOverview skillGovernance 的穷举用例（PR-E0.1 的 ①②④⑤ 判据）
 * @module test/services/core/skill/skillGovernance
 * @description
 * 这组用例守的是一句话：**没有登记的批准，就没有进上下文的权利**。
 * 每一处"缺失"都必须落在拒绝的一侧——把缺字段读成放行，是本次要修的洞的成因本身。
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import {
    SKILL_REVIEW, SKILL_ACTIONS, normalizeReviewStatus, skillEligibleForAssembly,
    checkContentHash, hostAllowed, decideSkillWrite, decideReviewTransition, governanceFieldsForWrite,
} from '../../../../services/core/skill/skillGovernance.js'

const ADMIN = {adminUserCodes: ['admin-1']}
const OWNER = {operator: {userCode: 'author-1', realName: '作者'}}

describe('1 normalizeReviewStatus：缺省即 pending', () => {
    test('合法值归一小写', () => {
        assert.equal(normalizeReviewStatus('approved'), SKILL_REVIEW.APPROVED)
        assert.equal(normalizeReviewStatus(' APPROVED '), SKILL_REVIEW.APPROVED)
        assert.equal(normalizeReviewStatus('rejected'), SKILL_REVIEW.REJECTED)
    })
    test('缺失、空串、非法值、非字符串 ⇒ 全部 pending（不许读成已批准）', () => {
        for (const v of [undefined, null, '', '   ', 'ok', 1, true, {}, ['approved']]) {
            assert.equal(normalizeReviewStatus(v), SKILL_REVIEW.PENDING, `${JSON.stringify(v)} 不该被当成批准`)
        }
        assert.equal(normalizeReviewStatus(), SKILL_REVIEW.PENDING)
    })
})

describe('2 skillEligibleForAssembly：status 与审核态是两个问题', () => {
    test('status 0 + approved ⇒ 进装配', () => {
        assert.equal(skillEligibleForAssembly({status: 0, reviewStatus: 'approved'}), true)
    })
    test('status 0 但未审核 ⇒ 不进（今天缺的就是这一半）', () => {
        assert.equal(skillEligibleForAssembly({status: 0}), false, '缺 reviewStatus 被读成放行 ⇒ 治理等于没做')
        assert.equal(skillEligibleForAssembly({status: 0, reviewStatus: 'pending'}), false)
        assert.equal(skillEligibleForAssembly({status: 0, reviewStatus: 'rejected'}), false)
    })
    test('approved 但被禁用/删除 ⇒ 不进', () => {
        assert.equal(skillEligibleForAssembly({status: 1, reviewStatus: 'approved'}), false)
        assert.equal(skillEligibleForAssembly({status: -1, reviewStatus: 'approved'}), false)
    })
    test('空值与非对象 ⇒ false，不抛', () => {
        for (const v of [null, undefined, 'x', 42, []]) {
            assert.equal(skillEligibleForAssembly(v), false)
        }
        assert.equal(skillEligibleForAssembly(), false)
    })
})

describe('3 checkContentHash：批准针对的是那一刻的内容', () => {
    test('哈希一致 ⇒ 放行且不降级', () => {
        const r = checkContentHash({skill: {skillMDHash: 'aaa'}, currentHash: 'aaa'})
        assert.deepEqual(r, {include: true, degrade: false, reason: 'ok'})
    })
    test('内容变了 ⇒ 当场剔除 + 审核态回 pending（D36 的 rug pull）', () => {
        const r = checkContentHash({skill: {skillMDHash: 'aaa'}, currentHash: 'bbb'})
        assert.equal(r.include, false)
        assert.equal(r.degrade, true)
        assert.equal(r.reason, 'hash-mismatch')
    })
    test('批准过但没存哈希 ⇒ 不剔除但要求重新批准（漏接线要能被发现）', () => {
        const r = checkContentHash({skill: {reviewStatus: 'approved'}, currentHash: 'bbb'})
        assert.equal(r.include, true)
        assert.equal(r.degrade, true)
        assert.equal(r.reason, 'hash-missing')
    })
    test('当前哈希取不到 ⇒ 按不一致处理（宁可剔除，不可放行未知内容）', () => {
        assert.equal(checkContentHash({skill: {skillMDHash: 'aaa'}, currentHash: ''}).reason, 'hash-mismatch')
        assert.equal(checkContentHash({skill: {skillMDHash: 'aaa'}}).reason, 'hash-mismatch')
    })
})

describe('4 hostAllowed：没配清单就是不准，不是不限', () => {
    test('清单为空 ⇒ 一律拒（把"未配置"读成"不限制"正是 §2C.3 的 allow-all 教训）', () => {
        const r = hostAllowed('ucenter:13001', {allowedHosts: []})
        assert.equal(r.allow, false)
        assert.equal(r.reason, 'host-list-unconfigured')
        assert.equal(hostAllowed('ucenter:13001', {}).reason, 'host-list-unconfigured')
    })
    test('通配与模板形态一律拒', () => {
        for (const h of ['*.svc', 'ucenter*', '10.42.*', '${HOST}', '.cluster.local']) {
            assert.equal(hostAllowed(h, {allowedHosts: [h]}).reason, 'host-wildcard', h)
        }
    })
    test('精确匹配（大小写与首尾空白不敏感）', () => {
        assert.equal(hostAllowed('UCenter:13001 ', {allowedHosts: ['ucenter:13001']}).allow, true)
    })
    test('不在清单内 ⇒ 拒；空主机 ⇒ 拒', () => {
        assert.equal(hostAllowed('evil:1', {allowedHosts: ['ucenter:13001']}).reason, 'host-not-allowlisted')
        assert.equal(hostAllowed('', {allowedHosts: ['ucenter:13001']}).reason, 'host-empty')
        assert.equal(hostAllowed(undefined, {allowedHosts: ['a']}).reason, 'host-empty')
    })
})

describe('5 decideSkillWrite：先身份、后权限；应急开关只旁路权限', () => {
    test('无身份 ⇒ 401，且 enforce=false 也不放行', () => {
        for (const enforce of [true, false]) {
            const r = decideSkillWrite({action: SKILL_ACTIONS.ADD, actor: {userCode: ''}, policy: {...ADMIN, enforce}})
            assert.equal(r.allow, false, `enforce=${enforce}`)
            assert.equal(r.statusCode, 401)
            assert.equal(r.reason, 'no-identity')
        }
    })
    test('注册新技能：只有管理员（add 没有归属人可言）', () => {
        assert.equal(decideSkillWrite({action: SKILL_ACTIONS.ADD, actor: {userCode: 'admin-1'}, policy: ADMIN}).allow, true)
        const r = decideSkillWrite({action: SKILL_ACTIONS.ADD, actor: {userCode: 'someone'}, policy: ADMIN})
        assert.equal(r.allow, false)
        assert.equal(r.statusCode, 403)
        assert.equal(r.reason, 'admin-required')
    })
    test('改/删/启/停：管理员或归属人；陌生人 403', () => {
        for (const a of [SKILL_ACTIONS.UPDATE, SKILL_ACTIONS.DELETE, SKILL_ACTIONS.ENABLE, SKILL_ACTIONS.DISABLE]) {
            assert.equal(decideSkillWrite({action: a, actor: {userCode: 'author-1'}, skill: OWNER, policy: ADMIN}).reason, 'owner', a)
            assert.equal(decideSkillWrite({action: a, actor: {userCode: 'admin-1'}, skill: OWNER, policy: ADMIN}).reason, 'admin', a)
            assert.equal(decideSkillWrite({action: a, actor: {userCode: 'x'}, skill: OWNER, policy: ADMIN}).allow, false, a)
        }
    })
    test('priv 授予也算管理员（ucenter hasPriv 的结果由调用方传入）', () => {
        assert.equal(decideSkillWrite({action: SKILL_ACTIONS.ADD, actor: {userCode: 'p-1'}, policy: {privGranted: true}}).allow, true)
    })
    test('enforce=false ⇒ 权限不足被旁路，但 reason 必须留下"本来该拒"的痕迹', () => {
        const on = decideSkillWrite({action: SKILL_ACTIONS.ADD, actor: {userCode: 'x'}, policy: {adminUserCodes: ['admin-1']}})
        const off = decideSkillWrite({action: SKILL_ACTIONS.ADD, actor: {userCode: 'x'}, policy: {enforce: false, adminUserCodes: ['admin-1']}})
        assert.equal(on.allow, false)
        assert.equal(off.allow, true, '开关按下去没效果 ⇒ 运维以为有退路，实际没有')
        assert.match(off.reason, /^enforce-off:admin-required$/, off.reason)
        assert.equal(off.statusCode, 403, '旁路了也要保留"本该 403"的痕迹，日志才说得出发生了什么')
    })
    test('enforce=false 不影响"管理员仍然放行"的正常路径', () => {
        assert.equal(decideSkillWrite({action: SKILL_ACTIONS.ADD, actor: {userCode: 'admin-1'}, policy: {enforce: false, adminUserCodes: ['admin-1']}}).reason, 'admin')
    })
    test('未知动作 ⇒ 拒（不因为"没列到"而默认放行）', () => {
        const r = decideSkillWrite({action: 'whatever', actor: {userCode: 'admin-1'}, policy: ADMIN})
        assert.equal(r.allow, false)
        assert.equal(r.reason, 'unknown-action')
    })
})

describe('6 decideReviewTransition：作者不能自批', () => {
    test('归属人批准自己的技能 ⇒ 403（这正是投毒者想要的那一步）', () => {
        const r = decideReviewTransition({to: SKILL_REVIEW.APPROVED, actor: {userCode: 'author-1'}, skill: OWNER, policy: ADMIN})
        assert.equal(r.allow, false)
        assert.equal(r.reason, 'admin-only')
        assert.equal(r.statusCode, 403)
    })
    test('管理员批准 ⇒ 放行', () => {
        assert.equal(decideReviewTransition({to: SKILL_REVIEW.APPROVED, actor: {userCode: 'admin-1'}, skill: OWNER, policy: ADMIN}).allow, true)
    })
    test('目标态非法（回 pending、乱写）⇒ 拒', () => {
        for (const to of ['pending', '', 'approved-ish', undefined]) {
            assert.equal(decideReviewTransition({to, actor: {userCode: 'admin-1'}, policy: ADMIN}).reason, 'invalid-target', String(to))
        }
    })
    test('无身份 ⇒ 401', () => {
        assert.equal(decideReviewTransition({to: SKILL_REVIEW.APPROVED, actor: null, policy: ADMIN}).statusCode, 401)
    })
})

describe('7 governanceFieldsForWrite：正文变了就不继承批准', () => {
    test('新增 ⇒ pending + 带哈希', () => {
        const f = governanceFieldsForWrite({newSkillMD: 'x', newHash: 'h1'})
        assert.equal(f.reviewStatus, SKILL_REVIEW.PENDING)
        assert.equal(f.skillMDHash, 'h1')
        assert.equal(f.reviewReset, true)
    })
    test('正文改了 ⇒ 打回 pending，并清掉旧的批准人与时间', () => {
        const f = governanceFieldsForWrite({
            skill: {skillMD: 'old', reviewStatus: 'approved', reviewedBy: {userCode: 'admin-1'}, reviewedAt: 'T'},
            newSkillMD: 'new', newHash: 'h2',
        })
        assert.equal(f.reviewStatus, SKILL_REVIEW.PENDING)
        assert.equal(f.reviewedBy, null)
        assert.equal(f.reviewedAt, null)
    })
    test('只改频道/备注（正文没动）⇒ 审核态继承，不重复走批准', () => {
        const f = governanceFieldsForWrite({skill: {skillMD: 'same', reviewStatus: 'approved', reviewedBy: {userCode: 'a'}}, newSkillMD: 'same', newHash: 'h'})
        assert.equal(f.reviewStatus, SKILL_REVIEW.APPROVED)
        assert.equal(f.reviewReset, false)
    })
    test('没给新哈希时保留旧哈希（不写成空串冒充"已核对"）', () => {
        const f = governanceFieldsForWrite({skill: {skillMD: 'same', skillMDHash: 'old-hash'}, newSkillMD: 'same'})
        assert.equal(f.skillMDHash, 'old-hash')
    })
})

describe('8 值域只有一份真相（防"两份同值分家"）', () => {
    /**
     * `daos/core/enum/SkillReviewEnum`（落库与 swagger）和 `skillGovernance.SKILL_REVIEW`（判据）
     * 是同一个域的两份声明。分家的后果很具体：枚举加了 revoked 而判据不认识它
     * ⇒ normalizeReviewStatus 把它归一成 pending ⇒ 一次"批准后撤销"被读成"从没审过"。
     */
    test('枚举与判据的值域逐项相等', async () => {
        const {default: SkillReviewEnum} = await import('../../../../daos/core/enum/SkillReviewEnum.js')
        const fromEnum = SkillReviewEnum.toValues().slice().sort()
        const fromPolicy = Object.values(SKILL_REVIEW).slice().sort()
        assert.deepEqual(fromEnum, fromPolicy, '两份值域不一致：改一处必须同时改另一处')
    })
    test('revoked 是合法态、不进装配、可被管理员重新批准或再次作废', () => {
        assert.equal(normalizeReviewStatus('revoked'), SKILL_REVIEW.REVOKED)
        assert.equal(skillEligibleForAssembly({status: 0, reviewStatus: 'revoked'}), false)
        assert.equal(decideReviewTransition({to: SKILL_REVIEW.REVOKED, actor: {userCode: 'admin-1'}, policy: ADMIN}).allow, true)
        assert.equal(decideReviewTransition({to: SKILL_REVIEW.APPROVED, actor: {userCode: 'admin-1'}, skill: {reviewStatus: 'revoked'}, policy: ADMIN}).allow, true)
    })
    test('把 revoked 归一成 pending 是错的（撤销不是遗漏）', () => {
        assert.notEqual(normalizeReviewStatus('revoked'), SKILL_REVIEW.PENDING)
        assert.equal(governanceFieldsForWrite({skill: {skillMD: 'same', reviewStatus: 'revoked'}, newSkillMD: 'same'}).reviewStatus, SKILL_REVIEW.REVOKED)
    })
})
