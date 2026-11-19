import { test, describe } from 'node:test'
import * as assert from 'node:assert'
import {
    buildRootTask,
    buildSerializedTurnTask,
    decideAndBuild,
} from '../../../../services/core/session/taskQueueComposer.js'

/**
 * 会话→任务组装/决策组合用例（PR-任务编排 M1-b 前置）。
 * 钉三件事：handler 不硬编（M2 前是空的）、id 不越俎（交下游 format）、判定复用不重造。
 */
describe('buildRootTask', () => {
    test('缺 conversationCode ⇒ 抛（root 必须挂会话）', () => {
        assert.throws(() => buildRootTask({}), /conversationCode/)
    })

    test('默认 handleMode=queue / handleStatus=0 / agentRole=root / 单智能体 local', () => {
        const r = buildRootTask({ conversationCode: 'c1', query: '做个调研' })
        assert.equal(r.handleMode, 'queue')
        assert.equal(r.handleStatus, 0)
        assert.equal(r.agentRole, 'root')
        assert.equal(r.agentType, 'local')
        assert.equal(r.budgetUsedTokens, 0)
    })

    test('handler 不硬编：不给就是空串（绝不指向 M2 才存在的 agentChat）', () => {
        assert.equal(buildRootTask({ conversationCode: 'c1' }).handler, '')
        assert.equal(buildRootTask({ conversationCode: 'c1', handler: 'whatever' }).handler, 'whatever')
    })

    test('不预填 agentCode/parentCode（交下游 formatWaitAddAgentTask 生成，避免两处生 id 打架）', () => {
        const r = buildRootTask({ conversationCode: 'c1' })
        assert.equal(r.agentCode, undefined)
        assert.equal(r.parentCode, undefined)
        assert.equal(r.rootCode, undefined, 'rootCode 拿到 agentCode 后由接线方回填')
    })

    test('request 的 channel/protocol/attachments 透传进 params', () => {
        const r = buildRootTask({
            conversationCode: 'c1', query: 'q',
            request: { channel: 'xxzx_common', protocol: 3, attachments: [{ fileCode: 'f' }] },
        })
        assert.equal(r.params.channel, 'xxzx_common')
        assert.equal(r.params.protocol, 3)
        assert.deepEqual(r.params.attachments, [{ fileCode: 'f' }])
    })

    test('agentType 脏值退化为 local（不写坏枚举）', () => {
        assert.equal(buildRootTask({ conversationCode: 'c1', agentType: 'nonsense' }).agentType, 'local')
    })

    test('带 planner 子任务 ⇒ subAgents 骨架，子 handler 缺省继承 root handler', () => {
        const r = buildRootTask({
            conversationCode: 'c1', agentType: 'parallel', handler: 'agentChat',
            subtasks: [{ title: 'A' }, { title: 'B', handler: 'x' }],
        })
        assert.equal(r.agentType, 'parallel')
        assert.equal(r.subAgents.length, 2)
        assert.equal(r.subAgents[0].handler, 'agentChat', '未指定则继承 root')
        assert.equal(r.subAgents[1].handler, 'x')
    })
})

describe('decideAndBuild', () => {
    test('proceed：放行且预算充裕 ⇒ 不建 root（交回现网 run 路径）', () => {
        const r = decideAndBuild({
            admission: {}, // 全不限 → proceed
            budget: { rootTokensUsed: 0, plannedSubtasks: 2 },
            build: { conversationCode: 'c1' },
        })
        assert.equal(r.action, 'proceed')
        assert.equal(r.rootTask, null)
    })

    test('queue：容量满 ⇒ 组 root 入队，reason 带 limitedBy', () => {
        const r = decideAndBuild({
            admission: { conversationActive: 8, conversationLimit: 8 },
            build: { conversationCode: 'c1', query: 'later' },
        })
        assert.equal(r.action, 'queue')
        assert.ok(r.rootTask, '排队要产出可入队的 root 记录')
        assert.equal(r.rootTask.conversationCode, 'c1')
        assert.equal(r.reason, 'capacity:conversation')
    })

    test('reject：队列满 ⇒ 不建 root（真忙，交回拒绝体）', () => {
        const r = decideAndBuild({
            admission: { conversationActive: 8, conversationLimit: 8, queueDepth: 5, maxQueue: 5 },
            build: { conversationCode: 'c1' },
        })
        assert.equal(r.action, 'reject')
        assert.equal(r.rootTask, null)
    })

    test('预算超支(single-agent 且 ok=false) ⇒ 转 queue（别硬开），root 带出', () => {
        const r = decideAndBuild({
            admission: {}, // 容量放行
            budget: { rootTokensUsed: 1_000_001, plannedSubtasks: 1 }, // 破 100 万
            build: { conversationCode: 'c1' },
        })
        assert.equal(r.budget.degrade, 'single-agent')
        assert.equal(r.budget.ok, false)
        assert.equal(r.action, 'queue')
        assert.ok(r.rootTask)
    })

    test('queue 时不查预算（预算只在放行时有意义）', () => {
        const r = decideAndBuild({
            admission: { subtaskActive: 4, subtaskLimit: 4 },
            budget: { rootTokensUsed: 999_999_999 },
            build: { conversationCode: 'c1' },
        })
        assert.equal(r.action, 'queue')
        assert.equal(r.budget, null, '容量都没过，预算不问')
    })
})

describe('buildSerializedTurnTask（用户追问轮：同会话串行、持久不派发）', () => {
    test('缺 conversationCode ⇒ 抛（不猜会话身份）', () => {
        assert.throws(() => buildSerializedTurnTask({ messageCode: 'm1' }), /conversationCode/)
    })

    test('缺 messageCode ⇒ 抛（本轮要按它落档，不能省）', () => {
        assert.throws(() => buildSerializedTurnTask({ conversationCode: 'c1' }), /messageCode/)
    })

    test('关键三点不同于 fan-out child：handleMode=manual / agentRole=serialized-turn / conversationCode 非隔离', () => {
        const r = buildSerializedTurnTask({ conversationCode: 'conv-user-1', messageCode: 'msg-1', query: '再讲讲第二点' })
        assert.equal(r.handleMode, 'manual', 'manual⇒addAgentTask 只持久不投 Kafka，防 consumer 无串行导致同会话并发')
        assert.equal(r.agentRole, 'serialized-turn', '是一轮用户对话，不是 fan-out 树根')
        assert.equal(r.agentType, 'local')
        assert.equal(r.handleStatus, 0)
        assert.equal(r.params.conversationCode, 'conv-user-1', '跑用户原会话才看得到前文')
        assert.ok(!String(r.params.conversationCode).startsWith('agent:'), '绝不用 agent: 隔离会话')
        assert.equal(r.params.messageCode, 'msg-1')
    })

    test('handler 不默认成 agentChat（它硬编 memory:off，忠实重放用户轮不能用它）——不给就是空串', () => {
        assert.equal(buildSerializedTurnTask({ conversationCode: 'c', messageCode: 'm' }).handler, '')
        assert.equal(buildSerializedTurnTask({ conversationCode: 'c', messageCode: 'm', handler: 'userTurn' }).handler, 'userTurn')
    })

    test('request 的 channel/protocol/llmModel/inputs 透传进 params（供忠实重放）', () => {
        const r = buildSerializedTurnTask({
            conversationCode: 'c', messageCode: 'm', query: 'q',
            request: { channel: 'xxzx_common', protocol: 3, llmModel: 'relay_common_pro', inputs: [{ type: 'image_url' }] },
        })
        assert.equal(r.params.channel, 'xxzx_common')
        assert.equal(r.params.protocol, 3)
        assert.equal(r.params.llmModel, 'relay_common_pro')
        assert.deepEqual(r.params.inputs, [{ type: 'image_url' }])
    })

    test('不预填 agentCode/rootCode（交下游 format 生成，避免两处生 id 打架）', () => {
        const r = buildSerializedTurnTask({ conversationCode: 'c', messageCode: 'm' })
        assert.equal(r.agentCode, undefined)
        assert.equal(r.rootCode, undefined)
    })

    test('忠实重放载荷：options / execUserInfo 原样存进 params（runner 据此与正常轮同形状调 execChat）', () => {
        const r = buildSerializedTurnTask({
            conversationCode: 'c', messageCode: 'm', query: 'q',
            options: { channel: 'xxzx_common', protocol: 2, memory: { enabled: true } },
            userInfo: { userCode: 'u1', realName: '张三' },
        })
        assert.deepEqual(r.params.options, { channel: 'xxzx_common', protocol: 2, memory: { enabled: true } })
        assert.deepEqual(r.params.execUserInfo, { userCode: 'u1', realName: '张三' })
        assert.equal(r.params.conversationCode, 'c', '本轮身份盖过 request 里的同名字段')
    })
})
