/**
 * @fileOverview 大模型对话频道的设置
 * @author xianyang
 * @module
 */

export default {
    /** 通用聊天助手 */
    micro_common: {
        /** 系统提示词 */
        sysPrompt: `你是一个高校师生教、学助手，请根据用户提供的用户资料回答用户的问题。`,
        /** 增强检索提示词 */
        ragPrompt: `## 用户资料： \n
    {{segs}}`,
        /** 可以调用的MCP配置列表 */
        mcpServers: {
            searxng: {
                transport: 'sse',
                url: 'http://localhost:32769/sse'
            }
        },
        /** 是否启用MCP调用 */
        enableMcp: true,
    },
    /** 文献助手 */
    pdfviewer_literature: {
        /** 系统提示词 */
        sysPrompt: `你是一个文献解读专家，请根据用户提供的文献材料回答用户的问题。`,
        /** 增强检索提示词 */
        ragPrompt: `## 文献材料： \n
    {{segs}}`,
        /** 是否启用MCP调用 */
        enableMcp: false,
    },
}