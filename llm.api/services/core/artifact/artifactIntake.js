/**
 * @fileOverview artifact intake 编排（§9.5 一致性顺序的执行骨架；依赖全注入，离线可测）
 * @module services/core/artifact/artifactIntake
 * @description
 * 把前几块的判据串成一条不许静默的流水线：**建账行(started) → execd 预热 → 拉字节(pulled) →
 * 流式转投 doc.api(uploaded) → 登记(registered) → 发 artifact_ready(ready)**；
 * 任一步失败按 §9.5 逆序回滚（planRollback 给的补偿序列），补偿也失败则落 failed 交对账兜底。
 *
 * 这里刻意**不 import 任何网络/库层**：文件 client、doc.api 上传器、登记 dac、幂等锁、事件发射
 * 全是注入的 deps——生产接线在 execChat 接线刀统一做（届时给 doc.api 真实现配真实读数）；
 * 本刀的价值是把"顺序、状态、回滚、完整性"在假件上证明干净，让真实现接上的只是薄接线。
 *
 * 四条不许商量：
 * 1. **状态只能沿 validateTransition 走**——编排自己跳步（如 uploaded→ready）也算 bug，走失败路径；
 * 2. **回滚起点按"已确立的外部事实"算，不按 CAS 状态**——CAS 写失败时账上的状态是旧的，
 *    若拿它推回滚计划会漏删已上传的 doc.api 文件（外部世界只认发生过什么）；
 * 3. **sha256/size 由本模块对收到的字节增量自算**，不信提供方自报（实测纪律，同 execdRange）；
 * 4. **补偿按 planRollback 给的数组顺序执行，不许重排**（先注销再删文件，反序制造悬空窗口）。
 */

import {createHash} from 'node:crypto'
import {INTAKE_STATE, validateTransition, planRollback} from './artifactReconcile.js'

/** 补偿动作 → 必须注入的执行器。缺执行器不算补偿成功——"没牙的回滚"比不回滚更危险（账显示清过，实际没清） */
const COMPENSATORS = {
    'unregister-artifact': 'unregisterArtifact',
    'delete-doc-api-file': 'deleteDocFile',
}

const REQUIRED_DEPS = ['idempotentRun', 'createRow', 'casState', 'waitExecdReady', 'pullFile', 'beginUpload', 'finalizeRegister', 'emitArtifactReady']

/**
 * @description 跑一次 intake（重放去重由 deps.idempotentRun 决定；本函数是"这一次"的完整生命周期）
 * @param {Object} task 任务
 * @param {String} task.artifactCode 产物标识（账本主键，接线方生成）
 * @param {String} [task.idempotencyKey] 幂等键 `${runCode}:${toolCallId}`
 * @param {String} task.sandboxId 来源沙箱
 * @param {String} task.path 沙箱内绝对路径
 * @param {String} [task.name] 展示名（缺省取 path 尾段）
 * @param {Function} deps.idempotentRun (key, fn) 重放去重（生产=l2Cache.acquireOnce）
 * @param {Function} deps.createRow (task) 建 started 账行
 * @param {Function} deps.casState (artifactCode, from, to) 状态 CAS（生产=dac；转移合法性本模块已挡）
 * @param {Function} deps.waitExecdReady (task) execd /ping 预热环（live 教训：Running≠可连，要重试环不是 sleep）
 * @param {Function} deps.pullFile ({task,onSlice}) 分段拉字节（生产=fetchFileBytes；onSlice(buffer,index)）
 * @param {Function} deps.beginUpload ({task}) → {write(buf,idx), finish()→{fileCode,fileUrl}, abort?()}
 * @param {Function} deps.finalizeRegister (task, meta) §9.5 第 3 步"登记"
 * @param {Function} deps.emitArtifactReady (doc) 发 artifact_ready
 * @param {Function} [deps.unregisterArtifact] 补偿执行器：注销登记（有被登记的可能就必须给）
 * @param {Function} [deps.deleteDocFile] 补偿执行器：删 doc.api 文件（同上）
 * @returns {Promise<Object>} {ok, state, artifactCode, ...}——流水线运行失败**不抛**（返回结构化结论）；缺依赖/缺主键才抛
 */
export async function runIntake(task = {}, deps = {}) {
    for (const k of REQUIRED_DEPS) {
        if (typeof deps[k] !== 'function') {
            throw new Error(`intake 缺依赖 ${k}（接线问题，不是运行失败）`)
        }
    }
    if (!task.artifactCode) throw new Error('task.artifactCode 不能为空')
    return deps.idempotentRun(task.idempotencyKey, () => pipeline(task, deps))
}

/** 一次完整生命周期。状态推进只经 go()，失败路径只汇于 rollback()。 */
async function pipeline(task, deps) {
    const artifactCode = task.artifactCode
    const seen = []
    /** 已确立的外部事实。回滚计划由它推，**不由** CAS 状态推（见模块头第 2 条）。 */
    const facts = {pulled: false, uploaded: false, registered: false}
    let fileCode = ''
    let fileUrl = ''
    let casFrom = INTAKE_STATE.STARTED

    async function go(to) {
        if (!validateTransition(casFrom, to)) {
            throw new Error(`非法状态转移 ${casFrom}→${to}（编排 bug，走失败路径）`)
        }
        await deps.casState(artifactCode, casFrom, to)
        casFrom = to
        seen.push(to)
    }

    const uploaderRef = {current: null}
    let uploadCleaned = false
    async function tryAbort() {
        const u = uploaderRef.current
        if (!u || uploadCleaned || typeof u.abort !== 'function') return
        uploadCleaned = true
        await Promise.resolve().then(() => u.abort()).catch(() => {})
    }

    try {
        await deps.createRow(task)
        seen.push(INTAKE_STATE.STARTED)
        await deps.waitExecdReady(task)

        // 拉字节与转投配对流式进行（§9.3：不整文件驻留）；指纹/字节数在本模块自算
        const hash = createHash('sha256')
        let sizeBytes = 0
        let sliceCount = 0
        uploaderRef.current = deps.beginUpload({task})
        const up0 = uploaderRef.current
        await deps.pullFile({
            task,
            onSlice: async (buf, index) => {
                hash.update(buf)
                sizeBytes += buf.length
                sliceCount = index + 1
                await up0.write(buf, index)
            },
        })
        facts.pulled = true
        await go(INTAKE_STATE.PULLED)

        const up = await up0.finish()
        fileCode = String((up && up.fileCode) || '')
        fileUrl = String((up && up.fileUrl) || '')
        if (!fileCode) {
            // finish 成功却没给把手：文件可能存在也可能不是，abort 尽力；**不许**继续登记一个没法引用的产物
            await tryAbort()
            return {
                ok: false, state: INTAKE_STATE.FAILED, artifactCode,
                failedAt: INTAKE_STATE.PULLED,
                error: 'doc.api 上传完成但未返回 fileCode：外部状态不可知，落 failed 交对账兜底',
                seen,
            }
        }
        facts.uploaded = true
        await go(INTAKE_STATE.UPLOADED)

        const sha256 = hash.digest('hex')
        await deps.finalizeRegister(task, {fileCode, fileUrl, sizeBytes, sha256, sliceCount})
        facts.registered = true
        await go(INTAKE_STATE.REGISTERED)

        // READY 先落账、事件后发：§9.5 对 READY 的定义是"发 artifact_ready **或写进 message 供重载**"——
        // 账行是权威，事件只是投递。事件失败降级为 warning；反过来（先发再落账）失败路径会回滚一个
        // 前端已见过的产物，制造悬空引用——那正是 artifactReconcile 判给对账、不判给流水线的场景。
        await go(INTAKE_STATE.READY)
        let warning = ''
        try {
            await deps.emitArtifactReady({
                artifactCode, fileCode, fileUrl, sizeBytes, sha256,
                name: task.name || String(task.path || '').split('/').pop(),
            })
        } catch (e) {
            warning = `已 ready 但 artifact_ready 事件发送失败（重载路径可见）：${String((e && e.message) || e).slice(0, 120)}`
        }
        return {ok: true, state: INTAKE_STATE.READY, artifactCode, fileCode, fileUrl, sizeBytes, sha256, sliceCount, seen, ...(warning ? {warning} : {})}
    } catch (e) {
        if (!facts.uploaded) await tryAbort()   // 没有"完整文件"可删；multipart 残片是 uploader 的 abort 责任
        return rollback(deps, artifactCode, casFrom, facts, e, {fileCode, seen})
    }
}

/** 回滚起点 = 最深的外部事实；补偿顺序 = planRollback 给的数组；任何一环失败 ⇒ failed */
async function rollback(deps, artifactCode, casFrom, facts, cause, ctx) {
    const failedAt = facts.registered ? INTAKE_STATE.REGISTERED
        : facts.uploaded ? INTAKE_STATE.UPLOADED
            : facts.pulled ? INTAKE_STATE.PULLED
                : INTAKE_STATE.STARTED
    const base = {ok: false, artifactCode, failedAt, error: String((cause && cause.message) || cause), seen: ctx.seen}
    const actions = planRollback(failedAt)
    const done = []
    for (const action of actions) {
        const fn = deps[COMPENSATORS[action]]
        if (typeof fn !== 'function') {
            await safeState(deps, artifactCode, casFrom, INTAKE_STATE.FAILED)
            return {...base, state: INTAKE_STATE.FAILED, compensations: done, error: `${base.error}；回滚缺执行器 ${action}（没牙的补偿不算补偿）`}
        }
        try {
            await fn(artifactCode, action === 'delete-doc-api-file' ? ctx.fileCode : undefined)
            done.push(action)
        } catch (e) {
            await safeState(deps, artifactCode, casFrom, INTAKE_STATE.FAILED)
            return {...base, state: INTAKE_STATE.FAILED, compensations: done, error: `${base.error}；补偿 ${action} 失败：${String((e && e.message) || e).slice(0, 120)}`}
        }
    }
    await safeState(deps, artifactCode, casFrom, INTAKE_STATE.ROLLED_BACK)
    return {...base, state: INTAKE_STATE.ROLLED_BACK, compensations: done}
}

/** 终态写入尽力而为：账写不上也不能盖掉原始失败原因 */
async function safeState(deps, artifactCode, from, to) {
    try { await deps.casState(artifactCode, from, to) } catch { /* 由对账兜底 */ }
}

export default {runIntake}
