/**
 * @fileOverview 进程配置自省 handler（§8/B3 值班面，只读零副作用）
 * @module services/agent/handler/taskSelfInspect
 * @description
 * 开闸批的"executor/cron 面直读"缺口：runStats 只报 http 进程自己的 env，值班要确认
 * "flag 真到了跑 finalize 的那个进程"，此前只能烧一棵行为树反证（批⑦⑧各一次）。本 handler
 * 把这条路变成一次任务投递：探针落一行 `{handler:'taskSelfInspect', handleMode:'queue'}` →
 * 目标进程的 consumer 消费执行 → handleRet 原样带回**该进程**的编排开关快照。
 *
 * 性格与红线：
 * - **只读白名单 echo**：只回显编排/开闸相关 flag（布尔/数值/短字符串），连接串、apiKey、
 *   user-info、模型配置整节**物理不碰**——这是能被任意建单路径投递的 handler，回显面宽一寸
 *   就多一寸泄漏面；白名单外的一律不出。
 * - 零副作用：不写库不派活不调模型；跑失败也只是 handleRet 缺席（探针超时如实报）。
 * - processName 取入口文件 basename（executor=http 消费/cron 的身份证据），不含路径全串。
 */
import BaseHandler from './base.js'

class TaskSelfInspect extends BaseHandler {
    constructor() {
        super('local')
    }

    async exec(agentTaskInfo) {
        const c = llm.config
        const at = c.agentTask || {}
        const oa = at.fanOutOrchestration || {}
        const pl = at.fanOutPlanner || {}
        const te = at.taskEvents || {}
        const cb = at.clarifyBubble || {}
        const lim = c.limits || {}
        const sw = lim.skillWriteIdempotency || {}
        const cq = lim.conversationTaskQueue || {}
        const procArg = String((process.argv && process.argv[1]) || '')
        return {
            handleStatus: 2,
            handleRet: {
                selfInspect: {
                    at: new Date().toISOString(),
                    pid: process.pid,
                    entry: procArg.split(/[\\/]/).pop() || '',  // 身份证据：agentTaskExecutor.js / server.js / …
                    orchestration: {
                        enabled: oa.enabled === true,
                        dispatch: String(oa.dispatch || 'kafka'),
                        autoFollow: oa.autoFollow === true,
                        layered: oa.layered === true,
                        synthGraceMs: Number(oa.synthGraceMs) || 0,
                        followSpawnCap: Number(oa.followSpawnCap) || 8,
                    },
                    planner: { enabled: pl.enabled === true, model: String(pl.model || 'relay_common_low') },
                    taskEvents: { enabled: te.enabled === true, keyPrefix: String(te.keyPrefix || 'llmtask:events'), eventDb: Number.isFinite(c.redisEventConfig?.db) ? c.redisEventConfig.db : 12 },
                    clarifyBubble: { enabled: cb.enabled === true },
                    limits: {
                        conversationTaskQueue: cq.enabled === true,
                        taskAttachment: lim.taskAttachment?.enabled === true,
                        skillWrite: sw.enabled === true,
                        skillWriteToolsCount: Array.isArray(sw.writeTools) ? sw.writeTools.length : 0,
                    },
                    creditsPriced: c.credits?.weights !== undefined,
                },
            },
            errorMsg: '', subsequentMode: '', subsequents: [],
        }
    }
}

export default TaskSelfInspect
