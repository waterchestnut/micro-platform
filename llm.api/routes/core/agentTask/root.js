/**
 * @fileOverview 智能体任务运维接口（恢复触发，诊断用）
 */
import {runAgentTaskRecover} from '../../../tasks/agentTaskRecover.js'

export const autoPrefix = '/core/agentTask'

export default async function (fastify, opts) {
    /**
     * §5-2 任务取消（**用户面**，区别于 /recover 的运维面）：只受理编排线的行——
     * 排队追问轮（agentRole:'serialized-turn'）与编排任务树（orchestrated:true 的 root）。
     * 判据全在纯件 taskCancel.planCancel（归属 fail-closed / 面收窄拒改建课等存量 / 在跑行不覆盖只计数），
     * 这里只做条件落库：`{agentCode, handleStatus:0}` 原子置 -1——判定与写之间 pump 可能认领走，
     * 0 命中如实计入 skipped，不谎报"已取消"。
     */
    fastify.post('/cancel', {
        schema: {
            description: '取消排队追问轮或编排任务树（仅发起人本人）。waiting 行置为已取消；'
                + '在途子任务无控制把手，将自然完成，但结果因取消标记不再聚合',
            summary: 'agentTask 取消',
            body: {
                type: 'object',
                required: ['agentCode'],
                properties: {
                    agentCode: {type: 'string', minLength: 1, maxLength: 128, description: '排队轮或编排 root 的 task 标识'},
                },
            },
            tags: ['agent'],
            response: {default: {}},
        },
    }, async function (request, reply) {
        const userCode = request.userInfo?.userCode
        if (!userCode) {
            const err = new Error('缺少有效的用户身份（user-info）')
            err.statusCode = 401
            throw err
        }
        const {planCancel} = await import('../../../services/core/session/taskCancel.js')
        const agentTaskDac = (await import('../../../daos/core/dac/agentTaskDac.js')).default
        const code = String(request.body?.agentCode || '')
        const target = await agentTaskDac.getByCode(code)
        // 树取消取整棵子树（agentCodePath 含自身）；排队轮只看自己
        let rows = target ? [target] : []
        if (target && target.agentRole === 'root' && target.orchestrated === true) {
            rows = await agentTaskDac.getTop(64, {complexFilter: {agentCodePath: code}}, {insertTime: 1})
        }
        const plan = planCancel({target, rows, userCode})
        if (!plan.ok) {
            const deny = {
                'not-owner': '无权取消该任务', 'not-found': '任务不存在',
                'scope-reject': '仅可取消排队追问轮或编排任务树', 'already-terminal': '任务已终态，无需取消',
            }[plan.reason] || plan.reason
            if (plan.reason === 'not-owner') {
                const err = new Error(deny)
                err.statusCode = 403
                throw err
            }
            return {statusCode: 200, code: -1, msg: deny, data: {reason: plan.reason}}
        }
        let aborted = 0, skipped = 0
        for (const u of plan.updates) {
            const ret = await agentTaskDac.update(
                {handleStatus: u.to, 'handleRet.cancelNote': u.why},
                {agentCode: u.agentCode, handleStatus: u.condStatus},
            )
            if ((ret?.modifiedCount || 0) > 0) aborted += 1
            else skipped += 1
        }
        let rootApplied = false
        if (plan.rootPatch) {
            // 只打取消标 + 非终态 root 置 3：点号 $set 不覆盖 finalize 已写的 sections/credits（最小侵入）
            const ret = await agentTaskDac.update(
                {
                    handleStatus: plan.rootPatch.to,
                    'handleRet.orchestration.cancelled': true,
                    'handleRet.orchestration.action': 'cancelled',
                    'handleRet.orchestration.reason': 'user-cancelled',
                },
                {agentCode: code, handleStatus: {$in: plan.rootPatch.condStatusIn}},
            )
            rootApplied = (ret?.modifiedCount || 0) > 0
        }
        request.log.info(`agentTask 取消: ${code} surface=${plan.response.surface} aborted=${aborted} skipped=${skipped} runningNoted=${plan.response.runningNoted} rootApplied=${rootApplied} user=${userCode}`)
        return {statusCode: 200, code: 0, data: {...plan.response, aborted, skipped, rootApplied}}
    })

    /**
     * §5-3 任务详情（用户面，只读）：编排 root 的进度/子任务态/裁决透传。
     * 面收窄同 /cancel——只受理 orchestrated root（建课等业务自有读取面，不在此开口子）；
     * 归属 fail-closed：非发起人 403。视图装配全在纯件 taskDetail（透传不重算，摘要如实 truncated）。
     * 正文全文不经此面（摘要之外走 /core/message/list 的成员制读取）。
     */
    fastify.post('/detail', {
        schema: {
            description: '查询编排任务树详情（仅发起人本人）：树相位、逐子任务状态/摘要（截断如实标注）、'
                + '裁决与追活审计透传、综合指针。全文走 /core/message/list',
            summary: 'agentTask 详情',
            body: {
                type: 'object',
                required: ['agentCode'],
                properties: {
                    agentCode: {type: 'string', minLength: 1, maxLength: 128, description: '编排 root 的 task 标识'},
                },
            },
            tags: ['agent'],
            response: {default: {}},
        },
    }, async function (request, reply) {
        const userCode = request.userInfo?.userCode
        if (!userCode) {
            const err = new Error('缺少有效的用户身份（user-info）')
            err.statusCode = 401
            throw err
        }
        const {buildTaskDetailView} = await import('../../../services/core/session/taskDetail.js')
        const agentTaskDac = (await import('../../../daos/core/dac/agentTaskDac.js')).default
        const code = String(request.body?.agentCode || '')
        const root = await agentTaskDac.getByCode(code)
        if (!root) return {statusCode: 200, code: -1, msg: '任务不存在', data: {reason: 'not-found'}}
        if (root.operator?.userCode !== userCode) {
            const err = new Error('无权查看该任务')
            err.statusCode = 403
            throw err
        }
        if (!(root.agentRole === 'root' && root.orchestrated === true)) {
            return {statusCode: 200, code: -1, msg: '仅编排任务树提供详情面', data: {reason: 'scope-reject'}}
        }
        const rows = await agentTaskDac.getTop(64, {complexFilter: {agentCodePath: code}}, {insertTime: 1})
        const view = buildTaskDetailView({root, rows})
        /** §5-4：实时树账（llmUsage 按 rootCode 聚合——关联列的查询面，不靠 conv 前缀反解） */
        const {getTreeUsage} = await import('../../../services/core/usageStats.js')
        view.usage = await getTreeUsage(code).catch((e) => ({error: String(e?.message || e).slice(0, 160)}))
        return {statusCode: 200, code: 0, data: view}
    })

    // 手动触发一轮中断任务恢复（与 cron 同一实现；运维排障/验证用）
    fastify.post('/recover', {
        schema: {
            description: '扫描滞留中断的 agentTask 并重排队列（handleStatus=0 且超时未更新）',
            summary: 'agentTask 中断恢复',
            body: {
                type: 'object',
                properties: {
                    stuckMs: {type: 'number', description: '滞留判定毫秒阈值，默认 30 分钟'},
                    maxRecover: {type: 'number', description: '单任务最大重排次数，默认 2'},
                    force: {type: 'boolean', description: '跳过 redis 锁（运维手动触发）', default: true},
                },
            },
            tags: ['agent', 'debug'],
            response: {default: {}},
        },
    }, async function (request, reply) {
        try {
            const requeued = await runAgentTaskRecover(request.body || {})
            return {statusCode: 200, code: 0, data: {requeued}}
        } catch (e) {
            request.log.error(e)
            reply.status(500).send({error: 'Internal Server Error'})
        }
    })

    // 指定任务强制恢复（忽略 recoverCount 限额与滞留阈值，运维单点救援）
    fastify.post('/recover-one', {
        schema: {
            description: '按 agentCode 直接重执行单个任务（force 语义：忽略恢复次数上限）',
            summary: 'agentTask 单点救援',
            body: {
                type: 'object',
                required: ['agentCode'],
                properties: {
                    agentCode: {type: 'string', description: '任务标识'},
                },
            },
            tags: ['agent', 'debug'],
            response: {default: {}},
        },
    }, async function (request, reply) {
        try {
            const {execAgentTask} = await import('../../../services/agent/index.js')
            const agentTaskDac = (await import('../../../daos/core/dac/agentTaskDac.js')).default
            const task = await agentTaskDac.getByCode(request.body.agentCode)
            if (!task) {
                return {statusCode: 200, code: -1, msg: '任务不存在'}
            }
            // fire-and-forget：长任务不阻塞请求；结果由 execAgentTask 自行落库
            execAgentTask(task)
                .then(ret => request.log.info(`recover-one ${task.agentCode} status=${ret?.handleStatus}`))
                .catch(e => request.log.error(e))
            return {statusCode: 200, code: 0, data: {triggered: task.agentCode, title: task.title}}
        } catch (e) {
            request.log.error(e)
            reply.status(500).send({error: 'Internal Server Error'})
        }
    })
}
