/**
 * @fileOverview 敏感信息识别与脱敏
 * @module tools/pii
 * @description 长期记忆要把对话原文存下来，脱敏必须发生在**入库前**：
 * 一旦 provider key / 手机号 / 身份证号进了 `memoryEvent`，之后的召回注入会把它反复带到模型那里。
 * 范围有意收窄（明确不做的见下方说明），宁可漏报可复核，也不要在识别上自作聪明地扩大打击面。
 *
 * 只做三类：
 * 1. 服务商密钥（`sk-` 开头长串）——泄进日志与记忆的风险最高。
 * 2. 11 位中国大陆手机号（可带 `+86`/`0086`/`86` 前缀，13~19 号段）。
 * 3. 18 位居民身份证号（含省份码、出生日期与校验位真实校验）。
 *
 * 明确不做：legacy 15 位身份证（无世纪位、格式歧义大）、他国号码（规则千差万别，误杀成本高于收益）。
 */

/** provider key：sk- 后接 16 位以上字母数字（OpenAI/DashScope/Hunyuan 等均此形态） */
const PROVIDER_KEY = /\bsk-[A-Za-z0-9_\-]{16,}\b/g

/** 手机号：前后不能再接数字，避免把长数字串里的一段误判 */
const MOBILE = /(?<!\d)(?:\+?86|0086|86)?[\s-]?1[3-9]\d{9}(?!\d)/g

/** 18 位身份证：省份码 + 出生年月日 + 顺序码，校验位单独验证 */
const ID_CARD_18 = /(?<!\d)[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)/g

/** 身份证校验位权重与映射（GB 11643-1999） */
const ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
const ID_CHECK_CODES = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2']

/** 省份码白名单，防止 5 位任意数字被当成地区 */
const PROVINCE_CODES = new Set(['11', '12', '13', '14', '15', '21', '22', '23', '31', '32', '33', '34', '35', '36', '37', '41', '42', '43', '44', '45', '46', '50', '51', '52', '53', '54', '61', '62', '63', '64', '65', '71', '81', '82', '91'])

/**
 * @description 校验 18 位身份证（省份码 + 日期 + GB 11643 校验位）
 * @author xianyang
 * @param {String} value 候选号码
 * @returns {Boolean} 是否真实合法
 */
export function isValidIdCard18(value) {
    const s = String(value || '')
    if (!/^\d{17}[\dXx]$/.test(s)) {
        return false
    }
    if (!PROVINCE_CODES.has(s.slice(0, 2))) {
        return false
    }
    const y = Number(s.slice(6, 10))
    const m = Number(s.slice(10, 12))
    const d = Number(s.slice(12, 14))
    if (y < 1900 || y > new Date().getFullYear()) {
        return false
    }
    const days = new Date(y, m, 0).getDate()
    if (m < 1 || m > 12 || d < 1 || d > days) {
        return false
    }
    let sum = 0
    for (let i = 0; i < 17; i++) {
        sum += Number(s[i]) * ID_WEIGHTS[i]
    }
    return ID_CHECK_CODES[sum % 11] === s[17].toUpperCase()
}

/**
 * @description 识别文本中的敏感信息
 * @author xianyang
 * @param {String} text 文本
 * @returns {Object[]} 命中列表 [{type, value, index}]
 */
export function detectPii(text) {
    const s = String(text || '')
    if (!s) {
        return []
    }
    const hits = []
    for (const m of s.matchAll(PROVIDER_KEY)) {
        hits.push({type: 'providerKey', value: m[0], index: m.index})
    }
    for (const m of s.matchAll(MOBILE)) {
        hits.push({type: 'mobile', value: m[0], index: m.index})
    }
    for (const m of s.matchAll(ID_CARD_18)) {
        if (isValidIdCard18(m[0])) {
            hits.push({type: 'idCard', value: m[0], index: m.index})
        }
    }
    return hits
}

/**
 * @description 用掩码替换敏感片段，保留可读的首尾片段以便人工核对
 * @author xianyang
 * @param {String} text 文本
 * @param {Object} [options] 选项
 * @param {String[]} [options.types] 只脱这些类型，缺省全部
 * @param {String} [options.placeholder] 掩码标记
 * @returns {Object} {text, hits, masked}
 */
export function maskPii(text, options = {}) {
    const s = String(text || '')
    const types = Array.isArray(options.types) && options.types.length ? options.types : null
    const placeholder = options.placeholder || '[已脱敏]'
    const hits = detectPii(s).filter(h => !types || types.includes(h.type))
    if (!hits.length) {
        return {text: s, hits: [], masked: false}
    }
    /** 按位置倒序替换，避免前面的替换让后续索引错位 */
    let out = s
    for (const hit of [...hits].sort((a, b) => b.index - a.index)) {
        out = out.slice(0, hit.index) + placeholder + out.slice(hit.index + hit.value.length)
    }
    return {text: out, hits, masked: true}
}

/**
 * @description 只留命中类型与个数，用于日志（绝不打印原文与完整命中值）
 * @author xianyang
 * @param {Object[]} hits detectPii 的结果
 * @returns {String} 摘要
 */
export function piiSummary(hits) {
    const count = {}
    for (const h of hits || []) {
        count[h.type] = (count[h.type] || 0) + 1
    }
    return Object.entries(count).map(([k, v]) => `${k}:${v}`).join(',') || 'none'
}

export default {detectPii, maskPii, isValidIdCard18, piiSummary}
