/**
 * @fileOverview 凭据来源审计（PR-E0.2 的"先可见"这一步，纯函数）
 * @module tools/secretSources
 * @description
 * E0.2 的完整动作是"轮换 + 部署清单改 Secret + 源码删兜底 + 缺 env 拒绝启动"。
 * 其中**删兜底与拒绝启动不能由我单方面做**：§25 已经记过一次同类事故——
 * 一次"纯结构调整"里顺手删掉源码里的 relay key，实测 dev 三个 deployment 都没配 `relay_*_apiKey`，
 * 结果是**发版即全站 401**。所以那两步必须等运维把 env 配上、并在有档期时统一轮换。
 *
 * 这一模块只做一件现在就能做、且零风险的事：**让"正在用代码兜底"可见**。
 * 现状是这些兜底完全静默——配置读起来一切正常，没人知道线上跑的是仓库里的值。
 * 而"没人知道"本身就是问题：它让"这个密钥还有效吗/该不该轮换"变成无法回答的问题（D40 要解决的正是这个）。
 *
 * 纪律：**任何函数都不返回、不打印、不记录密钥值本身**，只说"这个 env 有没有配"。
 * 一个把凭据值写进日志的"凭据治理工具"，本身就是新的泄漏面。
 */

/**
 * 已知的"env 取不到就用代码字面量"的凭据点。
 * 这张表由 `test/tools/secretSources.test.js` 与源码对账：**新增兜底会让测试红**，
 * 删掉一处也必须同步改这张表——这样"兜底清单"不会变成一份过期的注释。
 */
export const SECRET_DEFAULTS = [
    /**
     * 底座（micro-platform fork）实况：cw2pc 的凭据全部由部署 env 注入，源码里**没有**字面量兜底
     * （实证：conf/llmModel.js 与 conf/system.config.js 扫不到任何非空 ||/?? 字符串兜底；
     * 源仓 2026-11-13 实测出的那 5 处兜底不存在于这份代码里，那五处的清单与属主决定归源仓文件）。
     * 空清单 ≠ 关掉机制：auditSecretSources 照常跑、app.js 钩子照常挂，而"清单与源码双向对账"的围栏仍在岗——
     * 将来谁在底座源码里写回字面量兜底，就必须同步登记到这里，否则 test/tools/secretSources.test.js 立刻红。
     */
]

/**
 * @description 判断每个已知兜底点当前用的是 env 还是代码默认值
 * @param {Object} [env] 环境对象（测试注入用，默认 process.env）
 * @param {Array} [list] 清单（默认 SECRET_DEFAULTS；底座等 fork 场景注入自己的清单——机制与货单分离，围栏不该只能测真清单）
 * @returns {Array<{env: String, field: String, file: String, setInEnv: Boolean, usingCodeDefault: Boolean}>} 结果
 *
 * "配了但值是空白串"算**没配**：`process.env.X=''` 在 JS 里是假值，
 * 配置面如果把它当成"已提供"，就会在删兜底那天出现"env 明明设了却连不上"的怪故障。
 */
export function auditSecretSources(env = process.env, list = SECRET_DEFAULTS) {
    const src = env && typeof env === 'object' ? env : {}
    return (Array.isArray(list) ? list : []).map((d) => {
        const raw = src[d.env]
        const setInEnv = typeof raw === 'string' && raw.trim() !== ''
        return {env: d.env, field: d.field, file: d.file, note: d.note || '', setInEnv, usingCodeDefault: !setInEnv}
    })
}

/**
 * @description 汇总（给日志与巡检用）：总数、用兜底的数量、名字清单
 * @param {Array} audit auditSecretSources 的结果
 * @returns {{total: Number, usingCodeDefault: Number, envNames: String[], allSet: Boolean}} 结果
 */
export function summarizeAudit(audit) {
    const rows = Array.isArray(audit) ? audit : []
    const bad = rows.filter((r) => r.usingCodeDefault)
    return {
        total: rows.length,
        usingCodeDefault: bad.length,
        envNames: bad.map((r) => r.env),
        allSet: bad.length === 0,
    }
}

/**
 * @description 把审计结果拼成一行**不含任何密钥值**的日志文本
 * @param {Array} audit 审计结果
 * @returns {String} 结果
 */
export function formatAuditForLog(audit) {
    const s = summarizeAudit(audit)
    if (s.allSet) {
        return `凭据来源审计：${s.total} 项全部来自 env，无代码兜底`
    }
    return `凭据来源审计：${s.total} 项里有 ${s.usingCodeDefault} 项正在用代码兜底`
        + `（env 未配置：${s.envNames.join(', ')}）。`
        + '删兜底前必须先配好这些 env 并轮换密钥，否则发版即鉴权失败（见 docs/session-run-plan.md §25 的 relay key 事故）'
}

/**
 * @description 启动期报告：有兜底在用时 warn 一次
 * @param {Object} logger 日志器
 * @param {Object} [env] 环境对象（测试注入）
 * @returns {Object} 审计结果（便于调用方断言）
 *
 * 用 warn 而不是 error：**这不是故障**，系统现在跑得好好的；
 * 但它是"待偿还的债"，需要每次启动都在日志里出现一次，直到运维把它配齐。
 */
export function reportSecretSources(logger, env = process.env, list = SECRET_DEFAULTS) {
    const audit = auditSecretSources(env, list)
    const s = summarizeAudit(audit)
    if (s.usingCodeDefault > 0 && typeof logger?.warn === 'function') {
        logger.warn(formatAuditForLog(audit))
    }
    return audit
}

/**
 * @description 凭据来源态势判定（纯函数，判据与阻断分离——同 E0.6/retention 的纪律）
 * @param {Object} [p] 参数
 * @param {Boolean} [p.requireEnv] `secrets.requireEnv`（缺 env 是否拒绝启动），默认关
 * @param {Object} [p.env] 环境对象（测试注入）
 * @param {Array} [p.list] 清单（fork/测试注入，默认 SECRET_DEFAULTS）
 * @returns {{mode: String, blocks: Boolean, missing: String[]}} 结果
 *
 * 三档：
 *   ok                 全部来自 env ⇒ 无需告警、无需拒绝
 *   fallback-visible   有兜底在用、但未开强制 ⇒ 照常启动，只 warn（**dev 现状**）
 *   refused            有兜底在用**且**开了强制 ⇒ blocks=true，调用方拒绝启动
 *
 * ⚠️ **翻 `requireEnv=true` 的前置是运维已把 `SECRET_DEFAULTS` 里这些 env 配进 Secret**：
 * env 一个没配就开强制 ⇒ 每个 pod 启动即拒 ⇒ 全站停摆。这跟"先删字面量"是同一类"先配后扳机"的顺序约束，
 * 所以默认关、且翻开前必须逐一核对清单里的 env 都已在部署侧存在（用本模块的 auditSecretSources 自证，不靠记忆）。
 */
export function decideSecretsPosture({requireEnv = false, env = process.env, list = SECRET_DEFAULTS} = {}) {
    const s = summarizeAudit(auditSecretSources(env, list))
    if (s.allSet) {
        return {mode: 'ok', blocks: false, missing: []}
    }
    if (requireEnv) {
        return {mode: 'refused', blocks: true, missing: s.envNames}
    }
    return {mode: 'fallback-visible', blocks: false, missing: s.envNames}
}

/**
 * @description 强制模式下的启动闸门：只有 `refused` 才抛，且**错误信息里只有 env 名、没有值**
 * @param {Object} [p] 参数（透传给 decideSecretsPosture）
 * @returns {{mode: String, missing: String[]}} 放行时的态势（refused 不返回而是抛）
 */
export function assertSecretEnvPresent(p = {}) {
    const posture = decideSecretsPosture(p)
    if (posture.blocks) {
        // 绝不打印任何 env 值；只列缺哪个 env 名 + 处置指引
        throw new Error(
            `启动被拒绝（secrets.requireEnv=true）：以下凭据 env 未配置、仍在用源码兜底：${posture.missing.join(', ')}。`
            + '请先由运维把这些 env 配进 Secret 再启动（清单见 tools/secretSources.js 的 SECRET_DEFAULTS，逐项已与源码对账）。',
        )
    }
    return posture
}

