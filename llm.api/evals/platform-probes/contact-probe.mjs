/**
 * @fileOverview u2u 关系校验的端到端探针（PR-R0 + PR-E0.7 写侧）
 * @module evals/platform-probes/contact-probe
 * @description
 * 这条链路上有三处"只在真数据上才成立"的假设，探针逐个证伪：
 * 1. **ucenter 的两个新 rpc 真的能取到师生工号**（D53 的口径来自真实导师体系，不是纸面设计）；
 * 2. **有关系放行、无关系拒绝**，且拒绝的状态码是 4xx（越权探测不能被记成服务异常，与 §2D.2/PR-E0.7 读侧同一条纪律）；
 * 3. **fail-closed**：ucenter 不可达时必须拒绝，而缓存命中时不该因为一次抖动就把正常用户挡在门外。
 *
 * 用法（在 `src/` 下）：
 *   # 终端1：本机起 ucenter 的 grpc（默认 13001）
 *   #   cd xxzx.ucenter.api/src; $env:GRPC_PORT='13001'; node grpc/server.js
 *   # 终端2：
 *   node evals/platform-probes/contact-probe.mjs
 *   node evals/platform-probes/contact-probe.mjs --grpc=127.0.0.1:13001 --teacher=ZMLJS001
 *
 * 只读：全程不写 mongo、不发任何 u2u 消息（判定用的是取数与断言函数，不落业务数据）。
 */
import '../../init.js'

const argv = process.argv.slice(2)
const valOf = (n, d) => {
    const hit = argv.find(a => a.startsWith(`--${n}=`))
    return hit ? hit.split('=')[1] : d
}

const HOST = valOf('grpc', process.env.UCENTER_GRPC_HOST || '127.0.0.1:13001')
const TEACHER = valOf('teacher', 'ZMLJS001')
const log = (t, o) => console.log(JSON.stringify({probe: t, ...o}))

/**
 * @description 把 ucenter 的 gRPC 地址指到指定 host
 * @param {String} host 形如 127.0.0.1:13001
 * @returns {void}
 */
function setHost(host) {
    llm.config.ucenterConfig.grpcHost = host
}

setHost(HOST)
const {loadContactCodes, assertCanContact, clearContactCache} = await import('../../services/core/mentorContact.js')

const results = []
/**
 * @description 记一条断言
 * @param {String} name 断言名
 * @param {Boolean} pass 是否通过
 * @param {Object} [detail] 现场数据
 * @returns {void}
 */
function record(name, pass, detail = {}) {
    results.push({name, pass})
    log(name, {pass, ...detail})
}

clearContactCache()

/* 1) 取数：有关系的人必须取得到 */
const mine = await loadContactCodes(TEACHER)
record('1 取到关系数据', mine.ok === true, {
    host: HOST,
    学生数: mine.myStudentCodes.length,
    导师数: mine.myTeacherCodes.length,
    学生样例: mine.myStudentCodes.slice(0, 5),
})
if (!mine.ok) {
    log('结论', {判定: `❌ ucenter 不可达或 rpc 未实现（${mine.error}），后续断言无从可取`})
    process.exit(1)
}

const related = mine.myStudentCodes[0] || mine.myTeacherCodes[0]
record('2 有关系：放行', !!related && (await assertCanContact(TEACHER, related).then(() => true, () => false)),
    {target: related})

/* 3) 无关系：拒绝，且必须是 403 */
const stranger = 'contact-probe-nonexistent-user'
let denied = null
try {
    await assertCanContact(TEACHER, stranger)
    record('3 无关系：应拒绝却放行', false, {target: stranger})
} catch (e) {
    denied = {statusCode: e.statusCode, message: e.message, reason: e.contactReason}
    record('3 无关系：拒绝且状态码 403', e.statusCode === 403, denied)
}

/* 4) 自己与自己：拒绝（u2u 语义） */
try {
    await assertCanContact(TEACHER, TEACHER)
    record('4 自己与自己：应拒绝却放行', false)
} catch (e) {
    record('4 自己与自己：拒绝', e.statusCode === 403, {reason: e.contactReason, message: e.message})
}

/* 5) 无身份：401，不是 500 */
try {
    await assertCanContact('', related)
    record('5 无身份：应拒绝却放行', false)
} catch (e) {
    record('5 无身份：拒绝且状态码 401', e.statusCode === 401, {statusCode: e.statusCode, message: e.message})
}

/* 6) fail-closed：ucenter 不可达且无缓存 ⇒ 拒绝 */
clearContactCache()
setHost('127.0.0.1:1')
const down = await loadContactCodes(TEACHER)
record('6 ucenter 不可达：fail-closed 拒绝', down.ok === false, {error: String(down.error).slice(0, 120)})
try {
    await assertCanContact(TEACHER, related)
    record('6 上游故障时不应放行', false)
} catch (e) {
    record('6 上游故障：拒绝且 403', e.statusCode === 403, {reason: e.contactReason})
}

/* 7) 缓存：命中缓存在上游故障时仍放行（一次抖动不该挡住正常用户） */
setHost(HOST)
clearContactCache()
await loadContactCodes(TEACHER)          // 建缓存
setHost('127.0.0.1:1')                   // 上游立刻"挂掉"
try {
    await assertCanContact(TEACHER, related)
    record('7 缓存命中：上游抖动不阻断正常用户', true, {target: related})
} catch (e) {
    record('7 缓存命中：上游抖动不阻断正常用户', false, {reason: e.contactReason})
}
setHost(HOST)

/* 8) 开关：关掉校验（发布顺序用的应急阀） */
llm.config.ucenterConfig.contactCheckEnabled = false
clearContactCache()
setHost('127.0.0.1:1')
try {
    const d = await assertCanContact(TEACHER, stranger)
    record('8 contactCheckEnabled=false 时跳过校验', d.reason === 'disabled', d)
} catch (e) {
    record('8 contactCheckEnabled=false 时跳过校验', false, {message: e.message})
}
setHost(HOST)
llm.config.ucenterConfig.contactCheckEnabled = true

const failed = results.filter(r => !r.pass).map(r => r.name)
log('结论', {
    断言数: results.length,
    失败: failed.length,
    判定: failed.length ? `❌ ${failed.join('; ')}` : '✅ PR-R0 与 u2u 关系校验的七条假设全部成立',
})
process.exit(failed.length ? 1 : 0)
