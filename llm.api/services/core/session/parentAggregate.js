/**
 * @fileOverview updateParentAgentTaskWithLock 的锁内聚合判据（PR-任务编排 C 步骤 B0，纯函数）
 * @module services/core/session/parentAggregate
 * @description
 * 这个函数是**建课等所有现网 fan-out 的汇聚热路径**，但全仓没有一条可执行用例覆盖它的锁内决策
 * （recoverCandidate.js 文件头记的同款病：会改数据/发 Kafka 的逻辑只能靠读源码"验证"＝没验证）。
 * 要把 orchestrate 的触发焊进去（B1），前提是先有一张能跑的判定表把**现网行为**钉死——
 * 所以 B0 只做"逐行等价转写 + 建基线用例"，`updateParent` 行为零改变；B1 才加开关分叉。
 *
 * 三个判据（与 agentTask.js:59-92 现状一一对应，转写时不"顺手修正"任何看不惯的语义）：
 * - `reduceParentStatus`：依 subAgents + 本次 child 结果算父要写的字段（isDone→2/3；break 失败→3；toParentOutputKey 汇聚）。
 *   注意现状里 `[-1,3].includes(curRet.handleStatus)` 的 3 分支：leaf 正常不会出现 3，但语义照抄不删。
 * - `shouldDispatchNext`：父**首次**成功完成 + 非 manual + 有 nextAgentCode ⇒ 锁外投 Kafka 派发后继（:89-92 原样）。
 * - `shouldTriggerFinalize`：B1 新判据——编排 root 首次到终态才锁外派发 finalize task；每一侧条件都单独钉，
 *   防三类事故：递归到顶自己触发自己（死循环）、finalize 写完 root 再触发（二次循环）、非编排行误触（波及建课）。
 */

/** 终态集合（AgentHandleStatusEnum）：2 成功 / 3 完成含错 / -1 出错 */
const TERMINAL_NEW = (s) => s === 2 || s === 3

/**
 * @description 算"本次 child 结果汇入后，父要写什么"（等价转写 agentTask.js:59-81）
 * @param {Object} p
 * @param {Array} p.subAgents 父库内子任务冗余（读自加锁之后，可能尚未含本次 child 的新状态）
 * @param {Object} p.curAgentTaskInfo 本次完成的 child（{agentCode, errorMode, toParentOutputKey}）
 * @param {Object} p.curRet 本次 child 执行结果（{handleStatus, handleRet}）
 * @returns {{toUpdate:Object, newStatus:(Number|null)}} toUpdate 同现状形状；newStatus=要写的 handleStatus（无则 null）
 */
export function reduceParentStatus({ subAgents = [], curAgentTaskInfo = {}, curRet = {} } = {}) {
    let isDone = true
    let hasError = false
    for (const sub of (subAgents || [])) {
        const st = sub.agentCode === curAgentTaskInfo.agentCode ? curRet.handleStatus : sub.handleStatus
        if ([-1, 3].includes(st)) hasError = true
        if ([0, 1].includes(st)) isDone = false
    }
    const toUpdate = {}
    if (isDone) {
        toUpdate.handleStatus = hasError ? 3 : 2
    } else if ([-1, 3].includes(curRet.handleStatus) && curAgentTaskInfo.errorMode === 'break') {
        toUpdate.handleStatus = 3
    }
    if (curAgentTaskInfo.toParentOutputKey) {
        toUpdate.handleRet = { [curAgentTaskInfo.toParentOutputKey]: curRet.handleRet }
    }
    return { toUpdate, newStatus: toUpdate.handleStatus === undefined ? null : toUpdate.handleStatus }
}

/**
 * @description 锁外是否派发后继（等价转写 agentTask.js:89-92 的条件）
 * @param {Object} p
 * @param {Number|null} p.newStatus 本次要写入的父状态
 * @param {Number} p.prevStatus 写前的父状态
 * @param {String} p.handleMode 父执行模式
 * @param {String} [p.nextAgentCode] 父串行链后继
 * @returns {Boolean}
 */
export function shouldDispatchNext({ newStatus, prevStatus, handleMode, nextAgentCode } = {}) {
    return newStatus === 2 && ![2, 3].includes(prevStatus) && handleMode !== 'manual' && !!nextAgentCode
}

/**
 * @description 锁外是否派发 finalize task（B1 新增；默认关 ⇒ 恒 false，现网零影响）
 * @param {Object} p
 * @param {Number|null} p.newStatus 本次要写入的父状态
 * @param {Number} p.prevStatus 写前的父状态（递归路径上 = 刚写完的本层新状态）
 * @param {String} [p.agentRole] 父的角色（编排 root 才 finalize）
 * @param {Boolean} [p.orchestrated] 父是否声明为"需要编排 finalize"（显式标志，建课等老行绝不隐式命中）
 * @param {Boolean} p.enabled 总开关（fanOutOrchestration.enabled，关⇒恒 false）
 * @param {Boolean} [p.alreadyFinalized] 父已派发过 finalize（handleRet.orchestration 已存在）⇒ 不再触发
 * @param {Boolean} [p.isSelfRecursion] 本次是"父完成向父自己上报"的递归形态（curAgentTaskInfo===父 ⇒ 跳过）
 * @returns {Boolean}
 */
export function shouldTriggerFinalize({
    newStatus, prevStatus, agentRole, orchestrated, enabled, alreadyFinalized, isSelfRecursion,
} = {}) {
    if (enabled !== true) return false                       // 总开关关 ⇒ 逐字维持现网
    if (!orchestrated || agentRole !== 'root') return false  // 只认显式声明的编排 root，别碰建课等普通父
    if (TERMINAL_NEW(newStatus) !== true) return false       // 只在本层首次写入终态时触发
    if (TERMINAL_NEW(prevStatus) === true) return false      // 递归路径上父早已终态（多为刚写完自己）⇒ 跳过
    if (alreadyFinalized) return false                       // 幂等：finalize 结果已存在 ⇒ 绝不二次触发（防循环）
    if (isSelfRecursion) return false                        // 上报给父自己 ⇒ 不是"child 完成汇入"，跳过
    return true
}

export default { reduceParentStatus, shouldDispatchNext, shouldTriggerFinalize }
