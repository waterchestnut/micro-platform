/**
 * @fileOverview artifact intake 状态机 + 回滚顺序 + 双向孤儿对账（纯判据，零网络）
 * @module services/core/artifact/artifactReconcile
 * @description
 * D17 明写"intake 实现前：… 先定义孤儿语义"。§9.5 又定死了顺序：**拉字节 → 传 doc.api → 登记元数据；
 * 任一步失败按此序（逆序）回滚；孤儿由 `reconcile.js` 双向对账**。本模块就是把这两条落成**可离线穷举测**的判据，
 * 让后面接真实沙箱/doc.api 的编排与执行器拿的是"已证对错的决策函数"，不是边写边猜。
 *
 * 三条边界，免得这块被过度解读：
 * 1. **只分类、不动手**：本模块返回"该保留 / 该回滚哪些补偿步 / 哪些是孤儿待清 / 哪些是悬空引用"，
 *    真正的删除/注销是执行器的事，且默认关（同 census/retention：先有数、扳机交有权限的人）。
 * 2. **对账对象是 llm.api 自己的账，不是 doc.api 全量**：我们只知道"分配过哪些 fileCode、登记过哪些 artifact、
 *    哪些 message 引用了它们"。doc.api 侧"文件到底还在不在"是执行器要做的网络核验；判据只吃**已经核验回来的布尔**
 *    （`docFilePresent`），不假装能凭空知道。
 * 3. **幂等键贯穿**（§9 line 762）：分配记录与 artifact 记录靠 `idempotencyKey` 关联，重试/重放不能重复扣费或重复建文件；
 *    对账同样按 key 聚合，避免把"同一次 intake 的两条中间态"当成两个独立孤儿。
 *
 * 状态与回滚词表严格对齐 §9.1/§9.5，不另造。
 */

/** intake 生命周期状态（§9.5 一致性顺序的每一步） */
export const INTAKE_STATE = {
    STARTED: 'started',         // 拿到 save_artifact 请求、解析 execd 入口
    PULLED: 'pulled',           // 已从 execd 拉到字节（还在 llm.api 进程/流里，未落 doc.api）
    UPLOADED: 'uploaded',       // 已流式转投 doc.api，拿到 fileCode（但 artifact 记录可能还没登记）
    REGISTERED: 'registered',   // artifact 元数据 + 版本链已登记
    READY: 'ready',             // 已发 artifact_ready（或写进 message 供重载）
    ROLLED_BACK: 'rolled-back', // 失败后补偿完成
    FAILED: 'failed',           // 失败且补偿也没干净（需人工/对账兜底）
}

const FORWARD = [INTAKE_STATE.STARTED, INTAKE_STATE.PULLED, INTAKE_STATE.UPLOADED, INTAKE_STATE.REGISTERED, INTAKE_STATE.READY]

/**
 * @description 状态机合法性：只能沿 §9.5 的 forward 顺序前进一步，或（走完前）进入终态 rolled-back/failed
 * @param {String} from 当前状态
 * @param {String} to 期望下一状态
 * @returns {Boolean} 是否合法转移
 *
 * 为什么要钉：编排代码最怕"跳步"——直接 STARTED→READY 会跳过 doc.api 上传，凭空登记一个不存在的文件；
 * 这正是悬空记录(dangling)的制造路径。非法转移在这里就是 bug 信号，不是"宽容接受"。
 * READY 按 §9.5 视为**交付完成的终态**：之后文件缺失/损坏是"已交付事实出了问题"，归对账分类
 * （PROTECTED→mark-broken / DANGLING_RECORD）处理，不属于流水线"某步失败"，所以不许再从 READY 跳进 failed/rolled-back。
 */
export function validateTransition(from, to) {
    if (to === INTAKE_STATE.ROLLED_BACK || to === INTAKE_STATE.FAILED) {
        // 终态入口只认"还没走完"的中间态；READY 已交付，不能再被流水线判失败（幂等/重复事件与终态保护）
        return from !== INTAKE_STATE.READY && FORWARD.includes(from)
    }
    const i = FORWARD.indexOf(from)
    const j = FORWARD.indexOf(to)
    if (i < 0 || j < 0) return false
    return j === i + 1   // 只许前进一步
}

/**
 * @description 某步失败时，按 §9.5"逆序回滚"给出应执行的补偿动作序列（纯函数，只列该做哪些、不含执行）
 * @param {String} failedState 失败发生在哪一步（已进入但没继续的状态）
 * @returns {String[]} 逆序补偿动作（相对 failedState 之前已完成的事实）
 *
 * 顺序是刻意的：**先注销登记，再删 doc.api 文件**——反过来会先制造"文件没了但记录还在"的悬空窗口。
 * 还没发生的步骤不补偿（没上传就不必删文件）。PULLED 只在本进程内存里，无外部副作用 ⇒ 无需补偿、直接丢弃。
 * READY 也返回完整逆序：状态机不许流水线从 READY 自动跳回滚（见 validateTransition），
 * 但若人工/对账执行器确要回收一个已交付产物，"先 unregister 再删文件"仍是唯一正确顺序——本函数是顺序判据，不是触发器。
 */
export function planRollback(failedState) {
    const idx = FORWARD.indexOf(failedState)
    const actions = []
    // 只有"确实已登记过"才需注销；登记发生在 UPLOADED→REGISTERED 之后
    if (idx >= FORWARD.indexOf(INTAKE_STATE.REGISTERED)) {
        actions.push('unregister-artifact')
    }
    // 只有"确实已上传过 doc.api"才需删文件；上传发生在 PULLED→UPLOADED 之后
    if (idx >= FORWARD.indexOf(INTAKE_STATE.UPLOADED)) {
        actions.push('delete-doc-api-file')
    }
    // STARTED/PULLED 无外部持久副作用 → 返回空数组（直接放弃即可），不假装要"回滚字节"
    return actions
}

/** 对账分类结论（双向 + 在途保护） */
export const RECONCILE_CLASS = {
    CONSISTENT: 'consistent',       // 记录、doc.api 文件、message 引用三者自洽
    IN_FLIGHT: 'in-flight',         // 太新/未超宽限 ⇒ 正在 intake，绝不按孤儿处理
    PROTECTED: 'protected',         // 仍被 message 引用 ⇒ 就算缺文件也不能删，只能标记 broken
    ORPHAN_FILE: 'orphan-file',     // 分配/上传过、但无登记且无引用 ⇒ 泄漏的 doc.api 文件，可回收
    DANGLING_RECORD: 'dangling-record', // 登记了、但核验回来文件不在、且无有效引用 ⇒ 悬空记录
    ALLOC_WITHOUT_RECORD: 'alloc-without-record', // 分配了 fileCode 却没走到登记（崩溃在中间），既非孤儿文件也非悬空，属"半途分配"
}

/**
 * @description 单条 artifact 分配/记录的双向对账分类（纯函数）
 * @param {Object} a
 * @param {Boolean} a.registered   llm.api 是否有这条 artifact 登记
 * @param {Boolean} [a.docFilePresent] 执行器核验回来的"doc.api 文件是否在"；未知(undefined) 不当"在"也不当"不在"
 * @param {Boolean} [a.referencedByMessage] 是否仍被某条持久化 message 引用
 * @param {Boolean} [a.allocated]  llm.api 是否分配过这个 fileCode（上传账里有它）
 * @param {Number}  [a.ageMs]      自分配/登记起经过的毫秒
 * @param {Number}  [a.graceMs]    宽限期；未过 ⇒ in-flight
 * @returns {{klass: String, actions: String[], note: String}} 分类 + 建议动作（只列，不执行）
 *
 * 判据次序反映的是"别误删活物"的优先级，而非巧合：
 * 1. 超不过宽限期一律 in-flight（并发 intake 不是孤儿——同 retention/backfill 的窗口教训）；
 * 2. 被 message 引用 ⇒ 顶多标 broken，**永不删文件**（删了就是"用户看到的链接指向死文件"，比留一个坏记录更糟）；
 * 3. 有登记但核验文件缺失 ⇒ dangling-record（悬空，需标记或重拉，不是删引用）；
 * 4. 有分配、无登记、无引用 ⇒ orphan-file（回收候选）；
 * 5. 有分配、无登记、无文件、超窗 ⇒ alloc-without-record（半途崩溃残留，安全丢弃账目）。
 */
export function classifyArtifact({registered = false, docFilePresent, referencedByMessage = false, allocated = false, ageMs = 0, graceMs = 0} = {}) {
    if (!(ageMs > graceMs)) {
        return {klass: RECONCILE_CLASS.IN_FLIGHT, actions: [], note: '未过宽限期，按在途 intake 对待，绝不当孤儿'}
    }
    if (referencedByMessage) {
        // 引用优先：缺文件只能标 broken，不能删（保护用户可见链接）
        const actions = (docFilePresent === false) ? ['mark-broken', 'notify'] : []
        return {klass: RECONCILE_CLASS.PROTECTED, actions, note: docFilePresent === false ? '被引用但文件缺失：标记失效，不删' : '自洽且被引用：保留'}
    }
    if (registered && docFilePresent === false) {
        return {klass: RECONCILE_CLASS.DANGLING_RECORD, actions: ['mark-dangling', 'unregister-artifact?'], note: '登记了但文件核验不在：悬空记录，勿静默删引用'}
    }
    if (registered && docFilePresent !== false) {
        // registered 且文件在(或未知但未被证否)：若 unknown 交执行器再核验，这里按 consistent（unknown 不武断当缺）
        return {klass: RECONCILE_CLASS.CONSISTENT, actions: docFilePresent === undefined ? ['verify-doc-api'] : [], note: docFilePresent === undefined ? '登记在、文件存在性未核验：待核验，不算孤儿' : '三者自洽'}
    }
    if (allocated && !registered) {
        if (docFilePresent === false) {
            return {klass: RECONCILE_CLASS.ALLOC_WITHOUT_RECORD, actions: ['drop-allocation-ledger'], note: '分配过但既没上传成功也没登记：清分配账，无外部残留'}
        }
        return {klass: RECONCILE_CLASS.ORPHAN_FILE, actions: ['delete-doc-api-file', 'drop-allocation-ledger'], note: '上传过却没登记、又无人引用：孤儿文件回收候选（执行器删）'}
    }
    // 既没登记也没分配（理论上不该进到这里）：当作可忽略，不误删
    return {klass: RECONCILE_CLASS.CONSISTENT, actions: [], note: '无账可处理'}
}

/**
 * @description 汇总一批分配记录做双向对账（纯函数，像 planItemCounts 那样只数不删）
 * @param {Object[]} items classifyArtifact 的输入数组（一条 = 一个 idempotencyKey/fileCode 的观测）
 * @param {Number} [graceMs]
 * @returns {Object} 各分类的计数与成员（成员带 index），供执行器按类处理 + 供"孤儿双向对账有测试"门槛核对
 */
export function reconcileArtifacts(items = [], graceMs = 0) {
    const buckets = {}
    for (const k of Object.values(RECONCILE_CLASS)) buckets[k] = []
    ;(Array.isArray(items) ? items : []).forEach((raw, index) => {
        const c = classifyArtifact({...raw, graceMs})
        buckets[c.klass].push({index, ...raw, actions: c.actions, note: c.note})
    })
    const counts = {}
    for (const k of Object.keys(buckets)) counts[k] = buckets[k].length
    return {buckets, counts}
}

export default {
    INTAKE_STATE, validateTransition, planRollback, RECONCILE_CLASS, classifyArtifact, reconcileArtifacts,
}
