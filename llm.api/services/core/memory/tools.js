/**
 * @fileOverview 暴露给大模型的记忆工具
 * @module services/core/memory/tools
 * @description 三个工具对应长期记忆的写入、检索与取全文。
 * 刻意与 MCP / Skill 工具并列注册，让模型自己决定何时"记住"和"回查"，
 * 而不是把全部记忆无条件塞进上下文。
 */

import {getTokenizerOptions} from '../../openai/util.js'

const logger = () => (typeof llm !== 'undefined' && llm.logger ? llm.logger : console)

/** 工具返回给模型的正文上限，避免把长文整段灌回上下文 */
const RESULT_MAX_CHARS = 1200

function ok(data) {
    return JSON.stringify({success: true, data})
}

function fail(error) {
    return JSON.stringify({success: false, error: error?.message || String(error)})
}

export const MEMORY_TOOL_NAMES = new Set(['memory_save', 'memory_search', 'memory_get'])

/**
 * @description 构造三个记忆工具的 OpenAI function schema
 * @author xianyang
 * @returns {Object[]} 工具定义
 */
export function buildMemoryTools() {
    return [
        {
            type: 'function',
            function: {
                name: 'memory_save',
                description: '把一条值得长期记住的用户事实或偏好写入记忆。只在用户明确表达长期偏好、身份信息、稳定约束，或明确要求"记住"时调用。',
                parameters: {
                    type: 'object',
                    properties: {
                        content: {type: 'string', description: '一条独立可读的陈述句，不要复述整段对话'},
                        topic: {type: 'string', description: '主题词，便于按主题召回，如：语言偏好、职业身份'},
                        kind: {type: 'string', enum: ['fact', 'preference', 'decision', 'profile'], description: '内容类别'},
                    },
                    required: ['content', 'topic'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'memory_search',
                description: '按关键词检索已保存的记忆，返回命中条目列表（不含全文）。需要确认某条记忆是否存在或找相关内容时调用。',
                parameters: {
                    type: 'object',
                    properties: {
                        query: {type: 'string', description: '检索词或问题'},
                        topK: {type: 'number', description: '最多返回条数，默认 8'},
                    },
                    required: ['query'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'memory_get',
                description: '按记忆标识取回该条记忆的正文与证据，用于核实来源或在引用时给出依据。',
                parameters: {
                    type: 'object',
                    properties: {
                        atomCode: {type: 'string', description: '记忆标识，来自上下文注入的条目或 memory_search 结果'},
                    },
                    required: ['atomCode'],
                },
            },
        },
    ]
}

/**
 * @description 执行一个记忆工具调用
 * @author xianyang
 * @param {Object} params 入参
 * @param {Object} params.toolCall 工具调用（function.name / function.arguments）
 * @param {Object} params.context 执行上下文（用户、频道、会话、模型）
 * @returns {Promise<Object>} OpenAI tool 消息体 {tool_call_id, role:'tool', content}
 */
export async function executeMemoryTool({toolCall, context = {}} = {}) {
    const name = toolCall?.function?.name
    const callId = toolCall?.id
    let args = {}
    try {
        args = JSON.parse(toolCall?.function?.arguments || '{}')
    } catch (e) {
        return {tool_call_id: callId, role: 'tool', content: fail(new Error('参数不是合法 JSON'))}
    }

    const {userCode, channel, workspaceId = null, conversationCode, messageCode, curUserInfo, llmModel} = context
    if (!name || !MEMORY_TOOL_NAMES.has(name)) {
        return {tool_call_id: callId, role: 'tool', content: fail(new Error(`未知的记忆工具: ${name}`))}
    }
    if (!userCode || !channel) {
        return {tool_call_id: callId, role: 'tool', content: fail(new Error('缺少用户或频道上下文'))}
    }

    try {
        if (name === 'memory_save') {
            const {saveExplicit} = await import('./capture.js')
            const ret = await saveExplicit({
                curUserInfo: curUserInfo || {userCode},
                channel, workspaceId, conversationCode, messageCode, llmModel,
                content: args.content, topic: args.topic,
            })
            return {
                tool_call_id: callId, role: 'tool',
                content: ret?.ok ? ok({saved: true, atomCode: ret.atomCode}) : fail(new Error(ret?.reason || '未能保存')),
            }
        }

        if (name === 'memory_search') {
            const {getMemoryStore} = await import('./store/index.js')
            const store = await getMemoryStore()
            const hits = await store.search({
                userCode, channel, workspaceId, text: args.query,
                topK: Math.min(20, Number(args.topK) || 8),
            })
            return {
                tool_call_id: callId, role: 'tool',
                content: ok(hits.map(h => ({
                    atomCode: h.atomCode,
                    content: String(h.content || '').slice(0, RESULT_MAX_CHARS),
                    topic: h.atom?.topic, kind: h.atom?.kind, confidence: h.atom?.confidence,
                }))),
            }
        }

        const memoryAtomDac = (await import('../../../daos/core/dac/memoryAtomDac.js')).default
        const rows = await memoryAtomDac.getTop(1, {atomCode: args.atomCode, userCode, channel})
        const atom = rows?.[0]
        if (!atom) {
            return {tool_call_id: callId, role: 'tool', content: fail(new Error('记忆不存在'))}
        }
        return {
            tool_call_id: callId, role: 'tool',
            content: ok({
                atomCode: atom.atomCode,
                content: String(atom.content || '').slice(0, RESULT_MAX_CHARS),
                topic: atom.topic, kind: atom.kind, confidence: atom.confidence, source: atom.source,
                evidence: (atom.evidence || []).slice(0, 5),
            }),
        }
    } catch (e) {
        logger().error(`记忆工具执行失败(${name}/${userCode}): ${e.message}`)
        return {tool_call_id: callId, role: 'tool', content: fail(e)}
    }
}

/**
 * @description 判断某个工具名是否属于记忆工具
 * @author xianyang
 * @param {String} toolName 工具名
 * @returns {Boolean} 是否记忆工具
 */
export function isMemoryTool(toolName) {
    return MEMORY_TOOL_NAMES.has(toolName)
}

/**
 * @description 记忆工具的开关：频道开了 recall 或 capture 才挂，
 * 且模型必须配置了 contextWindow——工具轮次要往上下文里追加结果，
 * 没有窗口上限就无从计算留白，挂了反而容易把请求撑爆。
 * @author xianyang
 * @param {Object} params 入参
 * @param {Object} params.channelMemory 频道记忆配置
 * @param {Object} params.llmConfig 模型配置
 * @returns {Boolean} 是否启用
 */
export function memoryToolsEnabled({channelMemory, llmConfig} = {}) {
    /** 请求级逃生门可以把工具单独关掉（写记忆比读记忆更容易引起用户不适） */
    if (channelMemory?.tools === false) {
        return false
    }
    const grayed = Boolean(channelMemory?.enabled || channelMemory?.recall || channelMemory?.capture)
    if (!grayed) {
        return false
    }
    const contextWindow = Number(llmConfig?.contextWindow)
    if (!(contextWindow > 0)) {
        logger().warn(`模型未配置 contextWindow，跳过记忆工具以避免撑爆上下文`)
        return false
    }
    return Boolean(getTokenizerOptions(llmConfig))
}
