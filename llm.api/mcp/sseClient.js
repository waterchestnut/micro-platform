/**
 * @fileOverview SSE 模式的 MCP 客户端实现
 * @author xianyang
 * @module
 */

import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {SSEClientTransport} from '@modelcontextprotocol/sdk/client/sse.js'

const logger = (typeof llm !== 'undefined' && llm?.logger) ? llm.logger : console

/**
 * @description SSE 模式的 MCP 客户端类
 */
export class SseMcpClient {
    constructor(serverConfig, options = {}) {
        this.serverConfig = serverConfig
        this.url = serverConfig.url
        this.name = serverConfig.name || 'unknown'
        this.transport = serverConfig.transport || 'sse'

        this.options = {
            timeout: 30000,
            maxRetries: 3,
            retryDelay: 1000,
            ...options
        }
        this.client = null
        this.transportInstance = null
        this.isConnected = false
        this.reconnectAttempts = 0
        this.availableTools = []
        this.availableResources = []
    }

    /**
     * @description 连接到 MCP 服务器
     * @returns {Promise<boolean>} 连接是否成功
     */
    async connect() {
        try {
            logger.info(`正在连接到 MCP 服务器 ${this.name}: ${this.url}`)

            // 验证传输类型
            if (this.transport !== 'sse') {
                throw new Error(`不支持的传输类型: ${this.transport}`)
            }

            // 创建 SSE 传输层
            this.transportInstance = new SSEClientTransport(new URL(this.url))

            // 创建 MCP 客户端
            this.client = new Client(
                {
                    name: `llm-api-client-${this.name}`,
                    version: '1.0.0'
                },
                {
                    capabilities: {
                        tools: {},
                        resources: {},
                        prompts: {}
                    }
                }
            )

            // 连接到服务器
            await this.client.connect(this.transportInstance)
            this.isConnected = true
            this.reconnectAttempts = 0

            // 获取可用工具和资源
            await this.refreshCapabilities()

            logger.info(`成功连接到 MCP 服务器 ${this.name}: ${this.url}`)
            logger.info(`可用工具: ${this.availableTools.length} 个，可用资源: ${this.availableResources.length} 个`)
            return true

        } catch (error) {
            logger.error(`连接 MCP 服务器 ${this.name} 失败: ${error.message}`)
            this.isConnected = false
            return false
        }
    }

    /**
     * @description 断开连接
     */
    async disconnect() {
        try {
            if (this.client) {
                await this.client.close()
                this.client = null
            }
            if (this.transportInstance) {
                this.transportInstance = null
            }
            this.isConnected = false
            this.availableTools = []
            this.availableResources = []
            logger.info(`已断开 MCP 服务器 ${this.name} 连接`)
        } catch (error) {
            logger.error(`断开 MCP 服务器 ${this.name} 连接失败: ${error.message}`)
        }
    }

    /**
     * @description 列出可用的工具
     * @returns {Promise<Array>} 工具列表
     */
    async listTools() {
        if (!this.isConnected) {
            throw new Error('MCP 客户端未连接')
        }

        try {
            const result = await this.client.listTools()
            const tools = result.tools || []
            this.availableTools = tools
            return tools
        } catch (error) {
            logger.error(`获取工具列表失败: ${error.message}`)
            throw error
        }
    }

    /**
     * @description 刷新客户端能力（工具和资源）
     * @returns {Promise<void>}
     */
    async refreshCapabilities() {
        try {
            // 刷新工具列表
            await this.listTools()

            // 刷新资源列表
            await this.listResources()
        } catch (error) {
            logger.warn(`刷新客户端能力失败: ${error.message}`)
        }
    }

    /**
     * @description 调用工具
     * @param {string} toolName 工具名称
     * @param {Object} args 工具参数
     * @returns {Promise<Object>} 工具调用结果
     */
    async callTool(toolName, args = {}) {
        if (!this.isConnected) {
            throw new Error('MCP 客户端未连接')
        }

        try {
            logger.info(`调用 MCP 工具: ${toolName} ${JSON.stringify(args)}`)
            const result = await this.client.callTool({
                name: toolName,
                arguments: args
            })
            logger.info(`工具 ${toolName} 调用成功`)
            return result
        } catch (error) {
            logger.error(`调用工具 ${toolName} 失败: ${error.message}`)
            throw error
        }
    }

    /**
     * @description 列出可用资源
     * @returns {Promise<Array>} 资源列表
     */
    async listResources() {
        if (!this.isConnected) {
            throw new Error('MCP 客户端未连接')
        }

        try {
            const result = await this.client.listResources()
            const resources = result.resources || []
            this.availableResources = resources
            return resources
        } catch (error) {
            logger.error(`获取资源列表失败: ${error.message}`)
            throw error
        }
    }

    /**
     * @description 读取资源内容
     * @param {string} uri 资源 URI
     * @returns {Promise<Object>} 资源内容
     */
    async readResource(uri) {
        if (!this.isConnected) {
            throw new Error('MCP 客户端未连接')
        }

        try {
            logger.info(`读取 MCP 资源: ${uri}`)
            const result = await this.client.readResource({uri})
            logger.info(`资源 ${uri} 读取成功`)
            return result
        } catch (error) {
            logger.error(`读取资源 ${uri} 失败: ${error.message}`)
            throw error
        }
    }

    /**
     * @description 自动重连
     * @returns {Promise<boolean>} 重连是否成功
     */
    async reconnect() {
        if (this.reconnectAttempts >= this.options.maxRetries) {
            logger.error('已达到最大重连次数，停止重连')
            return false
        }

        this.reconnectAttempts++
        logger.info(`正在尝试第 ${this.reconnectAttempts} 次重连...`)

        // 等待重连延迟
        await new Promise(resolve => setTimeout(resolve, this.options.retryDelay))

        // 断开现有连接
        await this.disconnect()

        // 重新连接
        return await this.connect()
    }

    /**
     * @description 健康检查
     * @returns {Promise<boolean>} 服务是否健康
     */
    async healthCheck() {
        if (!this.isConnected) {
            return false
        }

        try {
            // 尝试获取服务器信息作为健康检查
            await this.client.ping()
            return true
        } catch (error) {
            logger.warn(`MCP 服务器健康检查失败: ${error.message}`)
            return false
        }
    }

    /**
     * @description 获取连接状态
     * @returns {Object} 连接状态信息
     */
    getStatus() {
        return {
            name: this.name,
            url: this.url,
            transport: this.transport,
            isConnected: this.isConnected,
            reconnectAttempts: this.reconnectAttempts,
            maxRetries: this.options.maxRetries,
            availableTools: this.availableTools.length,
            availableResources: this.availableResources.length,
            tools: this.availableTools.map(t => ({name: t.name, description: t.description})),
            resources: this.availableResources.map(r => ({uri: r.uri, name: r.name}))
        }
    }

    /**
     * @description 检查工具是否存在
     * @param {string} toolName 工具名称
     * @returns {boolean} 工具是否存在
     */
    hasTool(toolName) {
        return this.availableTools.some(tool => tool.name === toolName)
    }

    /**
     * @description 获取工具信息
     * @param {string} toolName 工具名称
     * @returns {Object|null} 工具信息
     */
    getToolInfo(toolName) {
        return this.availableTools.find(tool => tool.name === toolName) || null
    }
}

/**
 * @description 创建 MCP 客户端实例的工厂函数
 * @param {Object} serverConfig MCP 服务器配置
 * @param {Object} options 配置选项
 * @returns {SseMcpClient} MCP 客户端实例
 */
export function createMcpClient(serverConfig, options = {}) {
    return new SseMcpClient(serverConfig, options)
}