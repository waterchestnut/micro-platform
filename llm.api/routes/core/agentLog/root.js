/**
 * @fileOverview 智能体执行日志查询（诊断用，只读）
 */
import agentLogDac from '../../../daos/core/dac/agentLogDac.js'

export const autoPrefix = '/core/agentLog'

export default async function (fastify, opts) {
    // 按 agentCode 查任务日志（含子任务需分别查询；输出截断）
    fastify.post('/query', {
        schema: {
            description: '按 agentCode 查询智能体执行日志',
            summary: 'agent 日志查询',
            tags: ['agent', 'debug'],
            body: {
                type: 'object',
                required: ['agentCode'],
                properties: {
                    agentCode: {type: 'string', description: '智能体任务标识'}
                }
            },
            response: {}
        }
    }, async function (request, reply) {
        try {
            const {agentCode} = request.body
            const count = await agentLogDac.getCount({agentCode})
            const list = count ? await agentLogDac.getTop(Math.min(count, 50), {agentCode}, {insertTime: 1}) : []
            return {
                statusCode: 200,
                code: 0,
                data: list.map(l => ({
                    logCode: l.logCode,
                    group: l.group,
                    content: String(l.content || '').slice(0, 400),
                    insertTime: l.insertTime
                }))
            }
        } catch (err) {
            request.log.error(err)
            return {statusCode: 500, code: -1, message: err.message}
        }
    })
}
