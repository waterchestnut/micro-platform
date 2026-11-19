/**
 * @fileOverview 任务取消判据（PR-任务编排 §5-2，纯函数）
 * @module services/core/session/taskCancel
 * @description
 * "取消"表面一个按钮，底下是三件容易演错的事，本件把它们摊开成可穷举的判定：
 * 1. **面（scope）收窄**：只受理编排线的行——`agentRole:'serialized-turn'`（排队追问轮）与
 *    `orchestrated:true && agentRole:'root'`（扇出树）。建课等存量 agentTask **明确拒绝**：
 *    它们的失败/终态语义有自己的引擎约定（updateParent 机械汇聚），外部置态=在别人的状态机上乱写。
 * 2. **在跑的不能装死**：`handleStatus:1`（handling）的行有 execChat 在途，agentTask 引擎对 child
 *    **没有 run 控制把手**（agentChat 不注册 attachHandle——设计使然）。把它直接置 -1 会出现
 *    "库里说失败、进程还在跑并稍后回写 2"的分叉。所以：**waiting(0) 置 -1，handling(1) 只计数不动行**，
 *    响应如实标 `runningNoted`——完成后的结果因 root 已带 cancelled 而不再聚合（finalize 侧由
 *    `planFollowStep(cancelled)` 停止追活、写回落 cancelled）。
 * 3. **写必须带条件**：判"它是 waiting"与写"-1"之间，pump 可能刚认领走它。落库用
 *    `{agentCode, handleStatus:0}` 条件更新（单条 mongo update 原子），0 命中=状态已变，
 *    如实计入 `skipped`，不谎报"已取消"。
 * 归属：非本人一律 not-owner（fail-closed，与"验不了归属≠归属没问题"同规）；无身份 no-user。
 */

const TERMINAL = (s) => s === 2 || s === 3 || s === -1

/**
 * @description 取消一单（排队轮或编排树）的完整计划：可取消性、逐行动作、root 写回、响应形状
 * @param {Object} p
 * @param {Object} p.target 用户点名的行（serialized-turn 行或编排 root）
 * @param {Array}  [p.rows] 全树行（含 target 自己；serialized-turn 就传 [target]）
 * @param {String} p.userCode 当前登录用户
 * @returns {{ok:Boolean, reason:String, updates:Array<{agentCode:String, condStatus:Number, to:Number, why:String, keyField?:String}>, rootPatch:Object|null, response:Object|null}}
 */
export function planCancel({ target, rows = [], userCode } = {}) {
    const no = (reason) => ({ ok: false, reason, updates: [], rootPatch: null, response: null })
    if (!userCode) return no('no-user')
    if (!target || !target.agentCode) return no('not-found')
    if (target.operator?.userCode !== userCode) return no('not-owner')

    const isTurn = target.agentRole === 'serialized-turn'
    const isOrchRoot = target.agentRole === 'root' && target.orchestrated === true
    if (!isTurn && !isOrchRoot) return no('scope-reject')

    if (isTurn) {
        if (TERMINAL(target.handleStatus)) return no('already-terminal')
        return {
            ok: true,
            reason: 'cancel-turn',
            updates: [{ agentCode: target.agentCode, condStatus: 0, to: -1, why: 'user-cancelled' }],
            rootPatch: null,
            response: { cancelled: true, surface: 'serialized-turn', abortedWaiting: 1, runningNoted: 0 },
        }
    }

    // 编排 root 树
    if (TERMINAL(target.handleStatus)) return no('already-terminal')
    const updates = []
    let runningNoted = 0
    for (const r of rows) {
        if (!r || r.agentCode === target.agentCode) continue
        if (r.handleStatus === 0) updates.push({ agentCode: r.agentCode, condStatus: 0, to: -1, why: 'user-cancelled-tree' })
        else if (r.handleStatus === 1) runningNoted += 1 // 只计数不动行（无把手强停，见文件头 2）
    }
    const rootPatch = {
        // root 用 $in[0,1] 条件置 3（完成含错=用户中止的诚实终态）；已终态则 0 命中，不覆盖既有事实
        condStatusIn: [0, 1],
        to: 3,
        orchestration: { cancelled: true, action: 'cancelled', reason: 'user-cancelled' },
    }
    return {
        ok: true,
        reason: 'cancel-root',
        updates,
        rootPatch,
        response: {
            cancelled: true,
            surface: 'orchestration-root',
            abortedWaiting: updates.length,
            runningNoted,
            note: runningNoted > 0 ? '在途子任务无控制把手，将自然完成；结果因取消标记不再聚合' : undefined,
        },
    }
}

export default { planCancel }
