/**
 * @fileOverview 恢复轮对"一条候选任务"的处理（认领 → 决策 → 记数 → direct/requeue）
 * @module services/agent/recoverCandidate
 * @description
 * **这个模块为什么单独存在**（不是为了好看）：这段逻辑原先直接写在 `tasks/agentTaskRecover.js` 的循环里，
 * 而那个文件一 import 就会连 mongo（`daos/core/schema/index.js` 是顶层 await），
 * 于是它**没有任何一条分支被测试执行过**——守卫全是读源码文本的断言。
 * 2026-11-11 dev 端到端实验第一次真跑 direct 分支，当场抛
 * `TypeError: Assignment to constant variable.`：里层写了 `const claim = await acquireClaim(...)`，
 * 遮蔽了外层 `let claim`，而三条成功路径都有 `claim = null`。
 * 后果正是这次实验要防的那种：**任务被正常执行了，`recovered++` 和"恢复触发"日志却没有**，
 * 轮次日志显示 `触发=0` 外加一条 `恢复失败`；更糟的是 catch 里的"异常时释放认领"读的是外层那个
 * 永远是 null 的 `claim`，也就是说**那条守卫本身就是死的**。
 * ⇒ 判据：一条会改数据、会派活的分支，如果测试只能靠读文本来"验证"，那它等于没被验证过。
 *
 * 所以这里把effects全部外置：本模块**只 import 纯决策函数**，副作用一律由 `deps` 注入且必须提供
 * （缺一个就直接报出缺哪个）。这样测试用的假实现与线上用的是同一段真实代码路径，
 * 不会再出现"用例和我的 mock 自洽、却与真库不同"的第二例（redlock 那次记在 §25 v1.83）。
 */
import {claimDecision} from './execClaim.js'
import {recoverAction, DEFAULT_RECOVER_MODE} from './recoverPolicy.js'

/** 必须由调用方注入的副作用。列在这里就是这张接口的清单，缺项时报错也照这份报 */
export const REQUIRED_DEPS = ['acquireClaim', 'releaseClaim', 'updateTask', 'getParent', 'send', 'exec', 'log']

/**
 * @description 校验注入的副作用齐全（少给一个就立刻说清少了哪个，而不是跑到一半炸在 undefined 上）
 * @param {Object} deps 注入表
 * @returns {Object} deps
 * @throws {Error} 缺项或类型不对
 */
function checkDeps(deps) {
    if (!deps || typeof deps !== 'object') {
        throw new Error('recover-candidate-missing-deps')
    }
    for (const k of REQUIRED_DEPS) {
        if (typeof deps[k] !== 'function' && !(k === 'log' && deps[k] && typeof deps[k].info === 'function')) {
            throw new Error(`recover-candidate-missing-dep:${k}`)
        }
    }
    return deps
}

/**
 * @description 处理一条恢复候选
 * @param {Object} p 参数
 * @param {Object} p.task 任务行
 * @param {Number} [p.maxRecover] 单任务最大恢复次数
 * @param {String} [p.mode] `direct` / `requeue`（判据在 `recoverPolicy.recoverAction`）
 * @param {Number} [p.leaseMs] 认领租约长度
 * @param {Object} p.deps 注入的副作用（见 `REQUIRED_DEPS`）
 * @returns {Promise<Object>} `{outcome, reason?, state?, recoverCount}`，
 *          outcome ∈ `quota-exhausted` / `waiting-siblings` / `blocked` / `requeued` / `triggered`
 * @throws {Error} 数据写失败等真异常照常上抛（由调用方计入错误日志），但**抛之前一定释放已持有的认领**
 *
 * 三条不可交换的顺序，各钉一个实测过的病：
 * 1. **额度判据在取认领之前**：额度用完的行连锁都不该碰（省掉每轮 10 次无意义往返）；
 * 2. **取认领在写任何数据之前**：拿不到认领就跳过的行，一次都没被救，
 *    如果先把 `recoverCount` 加上去，它就白烧掉一个额度——等真断时已经没有额度可用；
 * 3. **交接后不再由本函数释放**：direct 模式锁的所有权随 `{claim}` 交给执行侧，
 *    由它的 `finally` 释放；这里再放一次就会误删别人的锁（dev 实测：执行完成后键确实已消失）。
 */
export async function recoverOneCandidate({task, maxRecover = 2, mode = DEFAULT_RECOVER_MODE, leaseMs, deps} = {}) {
    checkDeps(deps)
    const agentCode = task?.agentCode
    if (!agentCode) {
        throw new Error('recover-candidate-no-agent-code')
    }
    const cap = Number(maxRecover) > 0 ? Number(maxRecover) : 2
    const recoverCount = Number((task.tags || []).find(t => t.key === 'recoverCount')?.value || 0)
    if (recoverCount >= cap) {
        return {outcome: 'quota-exhausted', recoverCount, reason: `recoverCount>=${cap}`}
    }
    // 防乱序：仅恢复"轮到它"的任务——同父前置兄弟任务须已终结（2/-1/3），否则等前置收敛
    if (task.parentCode) {
        const parent = await deps.getParent(task.parentCode)
        const subs = parent?.subAgents || []
        const idx = subs.findIndex(s => s.agentCode === agentCode)
        if (idx > 0) {
            const prevPending = subs.slice(0, idx).some(s => s.handleStatus !== 2 && s.handleStatus !== -1 && s.handleStatus !== 3)
            if (prevPending) {
                return {outcome: 'waiting-siblings', recoverCount, reason: `prev-pending@${idx}`}
            }
        }
    }

    /**
     * 只有一个 `claim`，且它在 catch 里看得见。
     * 上一版这里写的是 `const claim = await acquireClaim(...)`（遮蔽外层），
     * 于是三条成功路径的 `claim = null` 全部抛 TypeError、catch 里的释放永远拿到 null。
     */
    let claim = null
    try {
        claim = await deps.acquireClaim({agentCode, leaseMs})
        const decision = claimDecision({role: 'recover', state: claim.state})
        if (!decision.proceed) {
            deps.log.info(`agentTask 恢复跳过: ${agentCode} ${decision.reason} `
                + `state=${claim.state}（有人正在执行，或锁层不可用——两种都不该由恢复接手）`)
            /** 跳过必须是一个数据动作都没做：`recoverCount` 一次都不该加 */
            return {outcome: 'blocked', reason: decision.reason, state: claim.state, recoverCount}
        }
        // 先记数占位（updateTime 顺延防重复扫描），再按配置的方式恢复
        await deps.updateTask({
            tags: [...(task.tags || []).filter(t => t.key !== 'recoverCount'), {key: 'recoverCount', value: String(recoverCount + 1)}],
        }, {agentCode})
        if (recoverAction({mode}) === 'requeue') {
            /**
             * 重投走的就是派发时那条 kafka 路径（同 topic、同 key/value 形状），
             * 消费者健康时由它执行；消费者停摆时这只是让消息继续堆积——**不会双跑，也不会救回来**。
             * 源仓因为实测过"堆积不消化"而用 direct；换环境要重新判断，别把我们的故障当成普适。
             *
             * 这条路径**不交接认领**：真正的执行者是消费者，它自己会取锁，
             * 所以我们发完就把锁放掉，不留一个"恢复了但占着锁"的中间态。
             */
            await deps.send(task)
            await deps.releaseClaim({lock: claim.lock, logger: deps.log})
            claim = null
            deps.log.info(`agentTask 恢复重投队列: ${agentCode}（${task.title || ''}）第${recoverCount + 1}次 mode=requeue`)
            return {outcome: 'requeued', recoverCount: recoverCount + 1}
        }
        /**
         * direct：**认领交接**给执行侧（`{claim}` 第二参），由 `execAgentTask` 的 finally 释放。
         * 不交接的话要么两次取同一把锁（自己和自己争用），要么这里先放了、
         * 执行侧还没跑起来——那中间的空档正好是恢复该防的窗口。
         *
         * `deps.exec` 若同步抛错（它内部先做参数校验），此时 `claim` 还没置空，
         * 下面的 catch 会把它放掉——所以顺序是"先调用成功、再交出手"。
         */
        deps.exec(task, {claim})
            .then(ret => deps.log.info(`agentTask 恢复执行完成: ${agentCode}（${task.title || ''}）status=${ret?.handleStatus}`))
            .catch(e => deps.log.error(`agentTask 恢复执行异常: ${agentCode} ${String(e?.stack || e?.message || e).slice(0, 400)}`))
        claim = null
        deps.log.info(`agentTask 恢复触发: ${agentCode}（${task.title || ''}）第${recoverCount + 1}次 mode=direct`)
        return {outcome: 'triggered', recoverCount: recoverCount + 1}
    } catch (e) {
        /**
         * 已经拿到但没交接出去的锁必须放掉，否则一次抛错就把这把锁占到租约到期（默认 15 分钟），
         * 期间真正的执行者拿不到锁（fail-open 会照样跑，但恢复会连续几轮把它判成"有人在跑"而跳过）。
         * 这条能生效的前提就是上面只有这一个 `claim` 变量。
         */
        if (claim?.lock) {
            await deps.releaseClaim({lock: claim.lock, logger: deps.log}).catch(() => {})
        }
        throw e
    }
}

export default {recoverOneCandidate, REQUIRED_DEPS}
