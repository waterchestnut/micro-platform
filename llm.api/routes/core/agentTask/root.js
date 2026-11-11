/**
 * @fileOverview 智能体任务运维接口（恢复触发，诊断用）
 */
import {runAgentTaskRecover} from '../../../tasks/agentTaskRecover.js'

export const autoPrefix = '/core/agentTask'

export default async function (fastify, opts) {
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
