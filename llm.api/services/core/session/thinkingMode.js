/**
 * @fileOverview 「这一轮到底有没有开深度思考」的决策与留痕（纯函数，零依赖）
 * @module services/core/session/thinkingMode
 * @description
 * 起因是 D44 那句话：**"思考开关是质量决策，不是性能开关……不得由 bug 默认决定"**。
 * 2026-11-13 实测到的现状是三层叠加，任何一层单独看都像"配置问题"：
 * 1. 服务端 `llmChat.js:455` 写的是 `options.enableThinking && llmConfig.enableThinking ? ... : {enable_thinking: false}`
 *    —— 请求参数排在前面，**短路在后**；
 * 2. dev 环境**没有任何** `*_enableThinking` 变量（14 个 `LLM_/RELAY_` 里零命中）⇒ 档位侧恒空；
 * 3. 三端前端把 `enableThinking: 0` **硬编码**在发送体里（console `Chat/index.tsx:463`、
 *    mopit `AIAssistant.tsx:390`、raisef `TeachingPlanChat.tsx:659`）⇒ 就算运维把档位配好了，聊天界面仍然关着。
 *
 * 结论：`enable_thinking:false` 不是"没人想过"，而是**由三个互不知情的默认值共同决定，且事后无法从数据里查**。
 * §16.4 P-3b 已经量过它的代价：`false` 时 `reasoning_tokens` 归零、`reasoning_content` 消失，
 * 连 prompt 字节都变小；`true` 时中位数 26–252 且**按输出计费**。
 * 所以这是一个"质量与成本都被静默决定"的口子。
 *
 * 本模块**刻意不改变任何行为**（接线顺序、真值语义与现状逐字一致），只补两件 D44 要求的事：
 * - 把决策**算成一条可核对的记录**（谁表态、档位有没有配、最终生效是什么、发出去的参数是什么）；
 * - 让"生效值"有唯一出处，避免以后有人在别处再写一个 `&&`。
 *
 * 为什么判据单独成模块：这三层里每一层的"真值"含义都不同（未表态 / 明确关 / 档位没配），
 * 混在一个 `&&` 里就只能得到"开或关"一个比特，而那正是查不出来的原因。
 */

/** 请求侧的三种可能：明确开、明确关、没有表态 */
export const THINKING_REQUESTED = {
    ON: 'on',
    OFF: 'off',
    UNSET: 'unset',
}

export const THINKING_EFFECTIVE = {
    ON: 'on',
    OFF: 'off',
}

/**
 * @description 把请求参数归一成"开 / 关 / 未表态"
 * @param {Object} v `options.enableThinking`（schema 只允许 boolean 与 number）
 * @returns {String} THINKING_REQUESTED 之一
 *
 * 真值语义与现状逐字一致：现有代码是 `options.enableThinking && ...`，也就是 JS 真值判断
 * （`0`/`false` 关，其它非零数字与 `true` 开）。这里**不趁机收紧**成"只认 0/1"——
 * 那会在同一次提交里悄悄改变线上行为，而本模块的目标只是把既有行为看清楚。
 */
export function normalizeRequested(v) {
    if (typeof v === 'boolean') {
        return v ? THINKING_REQUESTED.ON : THINKING_REQUESTED.OFF
    }
    if (typeof v === 'number') {
        return v ? THINKING_REQUESTED.ON : THINKING_REQUESTED.OFF
    }
    /** 其它类型（含 undefined）：schema 会挡在外面，但异常路径上也得给个诚实的答案 */
    return THINKING_REQUESTED.UNSET
}

/**
 * @description 档位侧有没有配思考参数
 * @param {Object} profile `llmConfig.enableThinking`（env `<model>_enableThinking` 的 JSON）
 * @returns {Boolean} 结果
 *
 * `{}` 算"配过"：现状 `llmConfig.enableThinking ? ...` 对空对象是真，展开后**一个 `enable_thinking` 都不发**
 * （交给上游默认）。这看起来像配置错误，但它是**可达行为**，改成"空对象视为未配"就会改变线上请求体。
 * 所以这里如实记录 `profileConfigured: true` + `params: {}`，把可疑之处留给读数而不是偷偷修。
 */
export function profileConfigured(profile) {
    /** 数组也算"配过"：现状 `profile ? ...` 对 `[]` 为真，展开后同样一个参数都不发。
     *  把它判成"未配"会改变那一支的请求体，而本模块不许改行为——可疑之处交给留痕去暴露。 */
    return !!profile && typeof profile === 'object'
}

/**
 * @description 算出这一轮的思考决策（纯函数，不落库、不发请求）
 * @param {Object} params 参数
 * @param {Object} [params.requested] `options.enableThinking` 原值
 * @param {Object} [params.profile] `llmConfig.enableThinking`（档位配置）
 * @returns {{requested: String, profileConfigured: Boolean, effective: String, params: Object, modelKey: String}} 决策
 *
 * `effective` 的语义与现状一一对应：**只有请求侧真值 且 档位配了**才开；否则发 `{enable_thinking:false}`。
 * `params` 就是最终并进上游请求体的那一段，调用方不得再自己拼。
 */
export function decideThinking({requested, profile, modelKey = ''} = {}) {
    const req = normalizeRequested(requested)
    const hasProfile = profileConfigured(profile)
    const on = req === THINKING_REQUESTED.ON && hasProfile
    return {
        requested: req,
        profileConfigured: hasProfile,
        effective: on ? THINKING_EFFECTIVE.ON : THINKING_EFFECTIVE.OFF,
        params: on ? profile : {enable_thinking: false},
        modelKey,
    }
}

/**
 * @description 落档该写的形态（缺决策时写 null，不写缺键）
 * @param {Object|null} decision decideThinking 的结果
 * @returns {Object|null} 结果
 *
 * 与 `regeneratedFromForArchive` 同一条规矩：**"确认没开"与"这一行的写法还不知道这件事"是两件事**。
 * 回填/停机路径拿不到决策时给 null，而不是给一个 `{effective:'off'}` 冒充"查过"。
 */
export function thinkingForArchive(decision) {
    if (!decision || typeof decision !== 'object' || Array.isArray(decision)) {
        return null
    }
    return {
        requested: decision.requested,
        profileConfigured: decision.profileConfigured === true,
        effective: decision.effective,
        modelKey: decision.modelKey || '',
    }
}
