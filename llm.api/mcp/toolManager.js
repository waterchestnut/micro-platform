/**
 * @fileOverview MCP 工具管理器 - 为大模型提供可调用的外部工具
 * @author xianyang
 * @module
 */

import {mcpClientManager} from './clientManager.js'
import llmChannelDataSet from '../conf/llmChannel.js'

const logger = llm.logger

/**
 * @description MCP 工具管理器类 - 专门为大模型 Function Calling 设计
 */
export class McpToolManager {
    constructor() {
        this.toolsCache = new Map() // 缓存工具定义
        this.initializedClients = new Set()
    }

    /**
     * @description 初始化频道的MCP客户端
     * @param {string} channel 频道名称
     * @param {Object} channelConfig 频道配置
     * @returns {Promise<boolean>} 初始化是否成功
     */
    async initializeChannel(channel, channelConfig) {
        if (this.initializedClients.has(channel)) {
            return true
        }

        if (!channelConfig.enableMcp || !channelConfig.mcpServers) {
            return false
        }

        try {
            // 创建所有配置的MCP客户端
            for (const [serverName, serverConfig] of Object.entries(channelConfig.mcpServers)) {
                const clientName = `${channel}_${serverName}`
                await mcpClientManager.createClient(clientName, serverConfig)
                logger.info(`MCP客户端 ${clientName} 创建成功`)
            }

            // 获取并缓存工具定义
            await this.refreshToolsCache(channel)
            this.initializedClients.add(channel)

            logger.info(`频道 ${channel} 的MCP工具初始化完成`)
            return true

        } catch (error) {
            logger.error(`初始化频道 ${channel} 的MCP工具失败: ${error.message}`)
            return false
        }
    }

    /**
     * @description 刷新工具缓存
     * @param {string} channel 频道名称
     * @returns {Promise<void>}
     */
    async refreshToolsCache(channel) {
        const tools = []
        const clientStatuses = mcpClientManager.getAllStatus()

        for (const clientStatus of clientStatuses) {
            if (!clientStatus.name.startsWith(`${channel}_`) || !clientStatus.isConnected) {
                continue
            }

            try {
                const clientTools = await mcpClientManager.listTools(clientStatus.name)
                for (const tool of clientTools) {
                    // 转换为OpenAI Function Calling格式
                    const openaiTool = {
                        type: 'function',
                        function: {
                            name: tool.name,
                            description: tool.description || '',
                            parameters: tool.inputSchema || {
                                type: 'object',
                                properties: {},
                                required: []
                            }
                        },
                        mcpClient: clientStatus.name, // 记录来源客户端
                        originalTool: tool
                    }
                    tools.push(openaiTool)
                }
            } catch (error) {
                logger.warn(`获取客户端 ${clientStatus.name} 的工具失败: ${error.message}`)
            }
        }

        this.toolsCache.set(channel, tools)
        logger.info(`频道 ${channel} 缓存了 ${tools.length} 个MCP工具`)
    }

    /**
     * @description 获取频道的可用工具（OpenAI Function Calling格式）
     * @param {string} channel 频道名称
     * @returns {Promise<Array>} 工具定义数组
     */
    async getTools(channel) {
        // 如果没有初始化，尝试初始化
        if (!this.initializedClients.has(channel)) {
            const channelConfig = llmChannelDataSet[channel]
            if (channelConfig) {
                await this.initializeChannel(channel, channelConfig)
            }
        }

        return this.toolsCache.get(channel) || []
    }

    /**
     * @description 执行工具调用
     * @param {string} channel 频道名称
     * @param {Array} toolCalls 工具调用数组（OpenAI格式）
     * @returns {Promise<Array>} 工具调用结果
     */
    async executeToolCalls(channel, toolCalls) {
        const results = []

        for (const toolCall of toolCalls) {
            const result = await this.executeSingleToolCall(channel, toolCall)
            results.push(result)
        }

        return results
    }

    /**
     * @description 执行单个工具调用
     * @param {string} channel 频道名称
     * @param {Object} toolCall 工具调用（OpenAI格式）
     * @returns {Promise<Object>} 工具调用结果
     */
    async executeSingleToolCall(channel, toolCall) {
        const {id: toolCallId, function: functionCall} = toolCall

        try {
            // 查找工具定义和对应的MCP客户端
            const tools = await this.getTools(channel)
            const tool = tools.find(t => t.function.name === functionCall.name)

            if (!tool) {
                throw new Error(`工具 ${functionCall.name} 不存在`)
            }

            const mcpClientName = tool.mcpClient
            logger.info(`执行工具调用: ${functionCall.name} (${mcpClientName})`)

            // 调用MCP工具
            const result = await mcpClientManager.callTool(
                mcpClientName,
                functionCall.name,
                JSON.parse(functionCall.arguments || '{}')
            )

            // 格式化返回结果为OpenAI格式
            return {
                tool_call_id: toolCallId,
                role: 'tool',
                content: JSON.stringify({
                    success: true,
                    data: result,
                    tool: functionCall.name,
                    client: mcpClientName
                })
            }

        } catch (error) {
            logger.error(`工具调用失败 ${functionCall.name}: ${error.message}`)

            return {
                tool_call_id: toolCallId,
                role: 'tool',
                content: JSON.stringify({
                    success: false,
                    error: error.message,
                    tool: functionCall.name
                })
            }
        }
    }

    /**
     * @description 检查频道是否有MCP工具
     * @param {string} channel 频道名称
     * @returns {Promise<boolean>} 是否有可用工具
     */
    async hasTools(channel) {
        const tools = await this.getTools(channel)
        return tools.length > 0
    }

    /**
     * @description 获取频道MCP状态
     * @param {string} channel 频道名称
     * @returns {Object} 状态信息
     */
    getChannelStatus(channel) {
        const tools = this.toolsCache.get(channel) || []
        const clientStatuses = mcpClientManager.getAllStatus()
        const channelClients = clientStatuses.filter(status =>
            status.name.startsWith(`${channel}_`)
        )

        return {
            initialized: this.initializedClients.has(channel),
            toolsCount: tools.length,
            clientsCount: channelClients.length,
            connectedClients: channelClients.filter(c => c.isConnected).length,
            tools: tools.map(t => ({
                name: t.function.name,
                description: t.function.description,
                client: t.mcpClient
            }))
        }
    }

    /**
     * @description 清除频道的MCP缓存
     * @param {string} channel 频道名称
     */
    clearChannelCache(channel) {
        this.toolsCache.delete(channel)
        this.initializedClients.delete(channel)

        // 断开相关客户端
        const clientStatuses = mcpClientManager.getAllStatus()
        for (const clientStatus of clientStatuses) {
            if (clientStatus.name.startsWith(`${channel}_`)) {
                mcpClientManager.removeClient(clientStatus.name)
            }
        }

        logger.info(`已清除频道 ${channel} 的MCP缓存`)
    }
}

/**
 * @description 执行单个工具调用的便捷函数
 * @param {string} channel 频道名称
 * @param {Object} toolCall 工具调用（OpenAI格式）
 * @returns {Promise<Object>} 工具调用结果
 */
export async function executeSingleToolCall(channel, toolCall) {
    return await mcpToolManager.executeSingleToolCall(channel, toolCall)
}

// 创建全局实例
export const mcpToolManager = new McpToolManager()