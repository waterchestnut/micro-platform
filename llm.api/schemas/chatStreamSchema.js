/**
 * @fileOverview 大模型流式对话接口的请求体约束
 * @module schemas/chatStreamSchema
 */

export const chatStreamBodySchema = {
    type: 'object',
    properties: {
        query: {type: 'string', description: '用户问题'},
        conversationCode: {
            type: 'string',
            description: '会话标识，仅允许字母、数字、下划线与中划线',
            minLength: 1,
            maxLength: 128,
            pattern: '^[0-9a-zA-Z_-]+$'
        },
        options: {
            type: 'object',
            properties: {
                llmModel: {type: 'string', description: '模型配置节点；缺省时按是否携带 inputs 选择默认文本/视觉模型'},
                channel: {type: 'string', description: '频道标识，必须是 conf/llmChannel.js 中已配置的频道，否则返回 400'},
                channelGroup: {type: 'string', description: '频道内分组，例如文献助手按资源标识分桶'},
                inputs: {type: 'array', description: '多模态输入片段，OpenAI content part 形态', items: {type: 'object'}},
                messageCode: {type: 'string', description: '消息标识，前端预生成可实现幂等与断点续传', minLength: 1, maxLength: 128},
                attachments: {type: 'array', description: '用户上传的文件材料', items: {type: 'object'}},
                answerAttachments: {type: 'array', description: '随回答产生的文件材料', items: {type: 'object'}},
                cache: {type: ['boolean', 'number'], description: '是否读写回答缓存，需与 channelCacheKey 同时提供'},
                channelCacheKey: {type: 'string', description: '缓存分组键'},
                regeneratedFrom: {type: 'string', description: '重新生成的来源消息标识；带这个键时本轮不读也不写回答缓存', minLength: 1, maxLength: 128},
                cacheIgnoreHistory: {type: ['boolean', 'number'], description: '跳过会话有历史则不使用缓存的保护，仅用于无状态批量场景'},
                enableThinking: {type: ['boolean', 'number'], description: '是否开启深度思考，受模型配置约束'},
                skillLoadMode: {type: 'string', enum: ['candidates', 'matched', 'full'], description: '技能加载模式'},
                memory: {
                    type: 'object',
                    description: '长期记忆的请求级逃生门，只能收窄不能放大：true/1 不会打开频道未灰度的能力，false/0 可关闭频道已开的项',
                    properties: {
                        enabled: {type: ['boolean', 'number'], description: '总开关，关闭即本轮完全不碰记忆'},
                        capture: {type: ['boolean', 'number'], description: '关闭则本轮不采集对话事件'},
                        recall: {type: ['boolean', 'number'], description: '关闭则本轮不注入记忆'},
                        tools: {type: ['boolean', 'number'], description: '关闭则本轮不挂 memory_* 工具'},
                        tokens: {type: 'number', minimum: 0, description: '记忆注入的 token 预算上限，只允许低于频道/全局配置'},
                        workspaceId: {type: ['string', 'null'], maxLength: 64, pattern: '^[0-9a-zA-Z][0-9a-zA-Z._-]*$', description: 'PR-16 工作区分区：给了则本轮记忆的写/召都限定在该分区（严格隔离，不与全局分区互见）；缺省/空=全局分区，行为与现状一致'},
                    },
                },
                /**
     * 工具迭代上限（原来硬编码在 llmChat.js 里）：打满会截断回答——
     * 最后一轮以工具结果 continue、又被 reset 清空正文 ⇒ 空答案落库。
     * 默认 6 与原值一致；请求级可覆盖，上限 20（与 llmLoop.MAX_ITERATIONS_CEILING 一致）。
     */
    maxIterations: {
        type: 'number',
        minimum: 1,
        maximum: 20,
        description: '本轮工具迭代上限；缺省取全局配置 limits.maxIterations（6）。打满时会自动补一次无工具收尾调用',
    },
    streamToolResults: {type: ['boolean', 'number'], description: '协议 1 客户端单独开启 tool_result；协议 2 默认下发'},
                protocol: {
                    type: 'number',
                    enum: [1, 2, 3],
                    description: 'SSE 事件协议版本；2=按事件名分派并附带 meta/tool_result，'
                        + '3=在 2 之上追加段边界事件 segment_start/segment_end（正文仍走 delta），缺省按 1 兼容旧客户端',
                },
                llmParams: {
                    type: 'object',
                    properties: {
                        maxTokens: {type: 'number', description: '最大返回tokens数量'},
                    },
                    description: '大模型提示词等相关的参数',
                    additionalProperties: {type: ['string', 'number', 'boolean']}
                },
                ragParams: {
                    type: 'object',
                    properties: {
                        resCode: {type: 'string', description: '资源标识'},
                        maxLength: {type: 'number', description: '最多返回资料片段数'},
                        maxTokens: {type: 'number', description: '最大输入材料tokens数量'},
                    },
                    description: '增强检索相关的参数',
                    additionalProperties: {type: ['string', 'number', 'boolean']}
                },
            }
        }
    },
    required: ['query', 'conversationCode'],
    anyOf: [
        {properties: {query: {type: 'string', minLength: 1}}},
        {
            properties: {
                options: {
                    type: 'object',
                    required: ['inputs'],
                    properties: {inputs: {type: 'array', minItems: 1}}
                }
            },
            required: ['options']
        },
    ]
}
/**
 * `/core/chat/stream/resume` 的请求体（PR-C）。
 *
 * 为什么 `messageCode` 必填而文档 §8.1 只写 `{lastSeq}`：那一行假设浏览器原生重连会带
 * `Last-Event-ID` 头。真实四端用的是 POST 体（EventSource 的自动重连会**重发整个 query**，
 * 那是"再问一次"不是"续上"，正是 §2E 要避免的行为），所以续接必须显式指出续哪一轮。
 * 头仍作为兜底读一次，两者都给时以体为准。
 */
export const chatResumeBodySchema = {
    type: 'object',
    properties: {
        messageCode: {
            type: 'string',
            description: '要续接的那一轮（= `meta` 帧里的 messageCode）',
            minLength: 1,
            maxLength: 128,
        },
        /**
         * 客户端**已经收到并解析完整**的最后一个事件号。
         * 必须整数且 >= 0：负数会被 `since()` 当成 0 而重放全部，等于一次免费的流量放大。
         */
        lastSeq: {type: 'integer', minimum: 0, description: '已收完整帧的最大 id；不带 Last-Event-ID 时必填'},
        conversationCode: {
            type: 'string',
            description: '会话标识（可选，仅用于校验 messageCode 归属一致）',
            maxLength: 128,
            pattern: '^[0-9a-zA-Z_-]+$',
        },
    },
    required: ['messageCode'],
    additionalProperties: false,
}
