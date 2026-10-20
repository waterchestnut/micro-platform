/**
 * @fileOverview OpenSandbox 沙箱执行处理器
 * @module services/agent/handler/sandbox
 * @description 把"执行模型生成的代码/命令"关进沙箱；注册表按文件名动态 import，
 * 所以本文件是零侵入 drop-in（不动 services/agent/index.js）。
 *
 * 两条硬约束（计划里定的，代码层强制）：
 * 1. **只做执行**：召回、装配、promote 一概不在这里发生，避免 Firecracker 的启动延迟进到聊天关键路径；
 * 2. **不传凭据进沙箱**：relay/服务商 apiKey 绝不进 env 或参数，只传任务需要的业务数据。
 *    命令文本本身由调用方负责（模型生成的代码里带密钥的情况由 PR-11 的 pii 检测在采集侧兜）。
 *
 * 失败也要回收：任何一步抛错都尽力 DELETE 沙箱，否则 dev 集群里会积一堆占着池的僵尸沙箱。
 */

import BaseHandler from './base.js'
import {addAgentLog} from '../../core/agentLog.js'
import {sandboxClient} from '../../sandbox/openSandbox.js'

const logger = llm.logger
const config = llm.config

/** 允许透传给沙箱的 env key 白名单前缀：避免把网关/模型凭据顺手带进沙箱 */
const ENV_KEY_ALLOW = /^(SANDBOX_|TASK_|APP_)/i

function pickEnv(env = {}) {
    const out = {}
    for (const [k, v] of Object.entries(env || {})) {
        if (!ENV_KEY_ALLOW.test(k)) {
            logger.warn(`沙箱 env 丢弃非白名单键 ${k}（凭据不得进沙箱）`)
            continue
        }
        out[k] = String(v)
    }
    return out
}

class SandboxHandler extends BaseHandler {
    constructor() {
        super('sandbox')
    }

    /**
     * @description 执行沙箱任务
     * @param {Object} agentTaskInfo 任务信息
     * @returns {Promise<Object>} 标准执行结果
     */
    async exec(agentTaskInfo) {
        const params = agentTaskInfo.params || {}
        const cfg = config.sandboxConfig || {}
        if (cfg.enabled === false) {
            throw new Error('沙箱执行未启用（sandbox_enabled=true 才开放），任务不降级到本进程执行')
        }
        const command = params.command || params.commands
        if (!command) {
            throw new Error('params.command 缺失：沙箱任务必须给出要执行的命令')
        }
        const client = sandboxClient()
        /**
         * 请求体严格按 specs/sandbox-lifecycle.yml 的 CreateSandboxRequest 组装：
         * 顶层**没有** poolRef 字段，池模式是 extensions.poolRef（字符串）；
         * 有 poolRef 时 resourceLimits/entrypoint 都可省（由 Pool CRD 决定），
         * 没有 poolRef 时 resourceLimits 必填、给了 image 就必须给 entrypoint。
         * 早先版本把 poolRef 放顶层，会被服务端 400 拒掉。
         */
        const body = {}
        const extensions = {...(params.extensions || {})}
        if (params.poolRef || cfg.defaultPoolRef) {
            extensions.poolRef = params.poolRef || cfg.defaultPoolRef
        }
        if (Object.keys(extensions).length) {
            body.extensions = extensions
        }
        const image = params.image || cfg.defaultImage
        const isPool = !!body.extensions?.poolRef
        if (params.snapshotId) {
            body.snapshotId = params.snapshotId
        } else if (image) {
            body.image = typeof image === 'string' ? {uri: image} : image
        }
        if (params.templateId) {
            body.templateId = params.templateId
        }
        const entrypoint = params.entrypoint || cfg.defaultEntrypoint
        if (entrypoint) {
            body.entrypoint = entrypoint
        } else if (!isPool && !params.snapshotId && !params.templateId && body.image) {
            throw new Error('非池模式且未指定 entrypoint：image 模式下 entrypoint 必填（CreateSandboxRequest 契约）')
        }
        if (!isPool && !body.snapshotId && !params.resourceLimits && !cfg.defaultResourceLimits) {
            throw new Error('非池模式必须提供 resourceLimits（契约：extensions.poolRef 未设置时必填）')
        }
        if (params.resourceLimits || cfg.defaultResourceLimits) {
            body.resourceLimits = params.resourceLimits || cfg.defaultResourceLimits
        }
        if (params.timeout ?? cfg.defaultTimeoutSeconds) {
            body.timeout = params.timeout ?? cfg.defaultTimeoutSeconds
        }
        body.env = pickEnv(params.env)
        if (params.metadata || cfg.defaultMetadata) {
            body.metadata = {...(cfg.defaultMetadata || {}), ...(params.metadata || {})}
        }
        if (params.networkPolicy) {
            body.networkPolicy = params.networkPolicy
        }

        addAgentLog(agentTaskInfo, `申请沙箱 pool=${body.extensions?.poolRef || '-'} image=${body.image?.uri || '-'} snapshot=${body.snapshotId || '-'}`, 'info')
        const {sandboxId} = await client.createSandbox(body)
        try {
            addAgentLog(agentTaskInfo, `沙箱就绪 ${sandboxId}，开始执行命令`, 'info')
            const ret = await client.runCommand({
                sandboxId,
                command,
                env: body.env,
                timeoutMs: params.execTimeoutMs || cfg.execTimeoutMs,
            })
            addAgentLog(agentTaskInfo, `沙箱执行完成 exitCode=${ret.exitCode}`, ret.exitCode === 0 ? 'info' : 'error')
            return {
                handleStatus: ret.exitCode === 0 ? 2 : -1,
                handleRet: {
                    sandboxId,
                    exitCode: ret.exitCode,
                    stdout: ret.stdout,
                    stderr: ret.stderr,
                    endpoint: ret.endpoint,
                },
                errorMsg: ret.exitCode === 0 ? '' : `沙箱命令退出码 ${ret.exitCode}：${String(ret.stderr || ret.stdout || '').slice(0, 500)}`,
                subsequentMode: '',
                subsequents: [],
            }
        } finally {
            /** 回收失败只记日志：沙箱有 expireTime 兜底，不能因为回收失败盖掉执行结果 */
            await client.destroySandbox(sandboxId).catch(e => {
                logger.warn(`沙箱回收失败 ${sandboxId}: ${e.message}（将由 expireTime 兜底）`)
                addAgentLog(agentTaskInfo, `沙箱回收失败 ${sandboxId}`, 'warn')
            })
        }
    }
}

export default SandboxHandler
