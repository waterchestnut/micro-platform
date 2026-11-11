/**
 * @fileOverview 智能体任务基础服务
 * @author xianyang 2025/9/8
 * @module
 */

import fs from 'fs'
import {addAgentLog} from '../core/agentLog.js'
import {
    updateAgentTaskWithLock,
    updateParentAgentTaskWithLock,
    updateSubAgentTaskWithLock
} from '../core/agentTask.js'
import agentTaskDac from '../../daos/core/dac/agentTaskDac.js'
import {sendMessage} from '../../daos/kafka/client.js'
import {acquireClaim, extendClaim, releaseClaim, claimDecision, shouldRenew} from './execClaim.js'
import tmplParse from 'json-templates'

const tools = llm.tools
const logger = llm.logger
const config = llm.config
const kafkaConfig = config.kafka

/*获取智能体处理器对象*/
async function getAgentHandler(handlerName) {
    let handlerFilePath = llm.baseDir + 'services/agent/handler/' + handlerName + '.js'
    if (!fs.existsSync(handlerFilePath)) {
        logger.error('getAgentHandler，智能体处理器不存在：' + handlerName)
        throw new Error('智能体处理器不存在')
    }
    let Handler = (await import('./handler/' + handlerName + '.js')).default
    /*console.log(Handler)*/
    return new Handler()
}

/**
 * @description 执行完整智能体任务项（带执行认领）
 * @param {Object} agentTaskInfo 任务信息
 * @param {Object} [opts] 选项
 * @param {Object} [opts.claim] **认领交接**：恢复轮已拿到的 `{lock}`。传进来就不再重复取锁，
 *                且由本函数负责释放（所有权随之转移，调用方不得再 release——两边都放会误删别人的锁）
 * @returns {Promise<Object>} 执行结果
 *
 * 为什么要在这一层取锁而不在核心逻辑里：调用方有六处（kafka 消费者、HTTP 触发、递归子任务、
 * `manualTriggerAgentTask`、恢复任务），锁的生命周期必须与"这一次执行"绑定，
 * 放在包装层就只需要一处 acquire/release，放在核心里就得六处保持一致。
 *
 * **取不到认领也照样执行**（`claimDecision` 对 executor 的规定）：
 * 认领的目的是让**恢复**能判断"有没有人在跑"，不是给正常执行加门禁。
 * 如果拿不到锁就不执行，我就把一个防重复机制变成了新的故障模式——
 * redis 抖一下，用户的任务全停。那种"修复"比它想防的问题更糟。
 */
export async function execAgentTask(agentTaskInfo, opts = {}) {
    if (!agentTaskInfo || agentTaskInfo.handleStatus !== 0) {
        /** 传进来的根本不是任务时不去写日志：`addAgentLog` 要读任务字段，在包装层里抛错会把调用方炸了 */
        if (agentTaskInfo) {
            addAgentLog(agentTaskInfo, '非等待执行的任务，无需执行', 'none')
        }
        return {
            handleStatus: agentTaskInfo?.handleStatus,
            handleRet: agentTaskInfo?.handleRet,
            errorMsg: '非等待执行的任务，无需执行'
        }
    }

    const leaseMs = Math.max(1000, Math.floor(Number(config.agentTask?.execLeaseMs) || 15 * 60 * 1000))
    let claim = opts.claim || null
    let lock = claim?.lock || null
    if (!claim) {
        const got = await acquireClaim({agentCode: agentTaskInfo.agentCode, leaseMs})
        claim = got
        lock = got.lock
        const d = claimDecision({role: 'executor', state: got.state})
        if (got.state !== 'granted') {
            /**
             * 每次都要把"这次执行没有认领保护"打出来：不是错误，但也不能假装没发生。
             * 恢复轮只看 `held` 与否；执行侧留下这行，才能事后回答"这段时间的重复执行是不是无人防护的"。
             */
            logger.warn(`agentTask 执行未获认领保护: ${agentTaskInfo.agentCode} state=${got.state} `
                + `reason=${got.reason}（按决策继续执行=${d.proceed}；本仓 dev 实测争用为 1ms，不阻塞）`)
        }
    }

    /**
     * 续期。节奏用**真实时间戳**判，而不是拿 `leaseMs/2` 去问 `shouldRenew`——
     * 那样分子分母是同一个常量，恒为真，是一条永远不会失败的装饰断言。
     * extend 失败（锁已不属于我们）就停手并告警：继续重试只会把已经丢失的保护伪装成还在。
     */
    let renewTimer = null
    if (lock) {
        let lastRenewAt = Date.now()
        renewTimer = setInterval(async () => {
            if (!shouldRenew({sinceRenewMs: Date.now() - lastRenewAt, leaseMs})) {
                return
            }
            const r = await extendClaim({lock, leaseMs})
            if (!r.ok) {
                logger.warn(`agentTask 认领续期失败（此后恢复可能误判为可救）: ${agentTaskInfo.agentCode} ${r.reason}`)
                clearInterval(renewTimer)
                renewTimer = null
                return
            }
            lastRenewAt = Date.now()
            if (r.lock) {
                lock = r.lock
                claim.lock = r.lock
            }
        }, Math.max(1000, Math.floor(leaseMs / 4)))
        /** 不能让一个后台续期定时器把进程钉在关闭流程里（发版时这是实打实的挂起） */
        renewTimer.unref?.()
    }

    try {
        return await execAgentTaskCore(agentTaskInfo)
    } finally {
        if (renewTimer) {
            clearInterval(renewTimer)
        }
        /** 只放过自己拿到的锁；`releaseClaim` 内部还会跳过已过期的情况（源仓实测能省 1978ms 的无谓等待） */
        const rel = await releaseClaim({lock, logger})
        if (rel.reason !== 'released' && rel.reason !== 'no-lock') {
            logger.info(`agentTask 认领释放: ${agentTaskInfo.agentCode} ${rel.reason}`)
        }
    }
}

/*执行完整智能体任务项（核心流程，认领与生命周期在 execAgentTask 包装层）*/
async function execAgentTaskCore(agentTaskInfo) {
    let parentAgentTask = null
    if (agentTaskInfo.parentCode) {
        parentAgentTask = await agentTaskDac.getByCode(agentTaskInfo.parentCode)
    }
    let handler = await getAgentHandler(agentTaskInfo.handler)
    let ret = {}
    try {
        let taskInfo = {...agentTaskInfo, parentRet: parentAgentTask?.handleRet}
        if (taskInfo.params) {
            let template = tmplParse(taskInfo.params)
            taskInfo.params = template(taskInfo)
        }
        ret = await handler.exec(taskInfo)
    } catch (e) {
        ret = {
            handleStatus: -1,
            handleRet: agentTaskInfo.handleRet,
            errorMsg: e.message || e,
            subsequentMode: '',
            subsequents: []
        }
        addAgentLog(agentTaskInfo, ret.errorMsg, 'error')
    }
    await updateAgentTaskWithLock(agentTaskInfo.agentCode, {handleStatus: ret.handleStatus, handleRet: ret.handleRet})
    if (parentAgentTask) {
        await updateParentAgentTaskWithLock(agentTaskInfo.parentCode, agentTaskInfo, ret, {})
    }
    if (ret.subsequents?.length) {
        let subAgentTaskList = await agentTaskDac.getTop(ret.subsequents.length, {agentCode: ret.subsequents.map(_ => _.agentCode)})
        if (!subAgentTaskList.length) {
            addAgentLog(agentTaskInfo, `subsequents 回查为空，任务树卡死：${ret.subsequents.map(s => s.agentCode).join(',')}`, 'error')
        }
        if (ret.subsequentMode === 'parallel') {
            await Promise.allSettled(subAgentTaskList.map(_ => execAgentTask(_)))
        } else {
            for (let i = 0; i < ret.subsequents.length; i++) {
                let subAgentTask = subAgentTaskList.find(_ => _.agentCode === ret.subsequents[i].agentCode)
                let subRet = await execAgentTask(subAgentTask)
                if ([-1, 3].includes(subRet.handleStatus) && subAgentTask.errorMode === 'break') {
                    break
                }
                if (subRet.appendAgents?.length > 0) {
                    let needBreak = false
                    for (let j = 0; j < subRet.appendAgents.length; j++) {
                        let appendAgentTask = subRet.appendAgents[j]
                        let appendSubRet = await execAgentTask(appendAgentTask)
                        if ([-1, 3].includes(appendSubRet.handleStatus) && appendAgentTask.errorMode === 'break') {
                            needBreak = true
                            break
                        }
                    }
                    if (needBreak) {
                        break
                    }
                }
            }
        }
    }
    // 链式推进仅在任务"执行完成"(2)时派发后继；dispatch型任务(sequential/parallel)exec返回1=进行中，
    // 其后继派发由 updateParent 首次完成路径负责（否则嵌套parallel下persist会在分片未完成时被过早触发）
    if (agentTaskInfo.nextAgentCode && ret.handleStatus === 2) {
        let nextAgentTask = await agentTaskDac.getByCode(agentTaskInfo.nextAgentCode)
        await sendMessage([{
            topic: kafkaConfig.topics.agentTask.topic,
            key: nextAgentTask.agentCode,
            value: JSON.stringify(nextAgentTask)
        }])
    }

    return ret
}

/*手动触发任务执行*/
export async function manualTriggerAgentTask(agentCode) {
    let agentTaskInfo = await agentTaskDac.getByCode(agentCode)
    return execAgentTask(agentTaskInfo)
}