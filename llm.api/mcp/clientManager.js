/**
 * @fileOverview MCP 客户端管理器
 * @author xianyang
 * @module
 */

import {createMcpClient} from './sseClient.js'

const logger = (typeof llm !== 'undefined' && llm?.logger) ? llm.logger : console

/**
 * @description MCP 客户端管理器类
 */
class McpClientManager {
    constructor() {
        this.clients = new Map() // 存储多个客户端实例
        this.defaultConfig = {
            timeout: 30000,
            maxRetries: 3,
            retryDelay: 1000
        }
    }

    /**
     * @description 创建并注册 MCP 客户端
     * @param {string} name 客户端名称
     * @param {Object} serverConfig MCP 服务器配置
     * @param {Object} options 配置选项
     * @returns {Promise<Object>} 客户端实例
     */
    async createClient(name, serverConfig, options = {}) {
        if (this.clients.has(name)) {
            logger.warn(`客户端 ${name} 已存在，将替换现有连接`)
            await this.removeClient(name)
        }

        const client = createMcpClient({...serverConfig, name}, {...this.defaultConfig, ...options})

        // 尝试连接
        const connected = await client.connect()
        if (!connected) {
            throw new Error(`无法连接到 MCP 服务器: ${serverConfig.url}`)
        }

        this.clients.set(name, client)
        logger.info(`MCP 客户端 ${name} 创建并连接成功`)
        return client
    }

    /**
     * @description 获取客户端实例
     * @param {string} name 客户端名称
     * @returns {Object|null} 客户端实例
     */
    getClient(name) {
        return this.clients.get(name) || null
    }

    /**
     * @description 移除并断开客户端
     * @param {string} name 客户端名称
     * @returns {Promise<boolean>} 操作是否成功
     */
    async removeClient(name) {
        const client = this.clients.get(name)
        if (!client) {
            logger.warn(`客户端 ${name} 不存在`)
            return false
        }

        try {
            await client.disconnect()
            this.clients.delete(name)
            logger.info(`MCP 客户端 ${name} 已移除`)
            return true
        } catch (error) {
            logger.error(`移除客户端 ${name} 失败: ${error.message}`)
            return false
        }
    }

    /**
     * @description 批量创建客户端
     * @param {Object} serverConfigs 服务器配置对象 {name: config, ...}
     * @param {Object} globalOptions 全局配置选项
     * @returns {Promise<Object>} 创建结果
     */
    async createClients(serverConfigs, globalOptions = {}) {
        const results = {}
        const tasks = Object.entries(serverConfigs).map(async ([name, serverConfig]) => {
            try {
                const client = await this.createClient(name, serverConfig, globalOptions)
                results[name] = {success: true, client}
            } catch (error) {
                results[name] = {success: false, error: error.message}
            }
        })

        // Run all creations in parallel and wait for all to settle
        await Promise.allSettled(tasks)
        return results
    }

    /**
     * @description 获取所有客户端状态
     * @returns {Array} 客户端状态列表
     */
    getAllStatus() {
        const statusList = []
        for (const [name, client] of this.clients) {
            statusList.push({
                name,
                ...client.getStatus()
            })
        }
        return statusList
    }

    /**
     * @description 健康检查所有客户端
     * @returns {Promise<Array>} 健康检查结果
     */
    async healthCheckAll() {
        const results = []
        for (const [name, client] of this.clients) {
            try {
                const isHealthy = await client.healthCheck()
                results.push({
                    name,
                    healthy: isHealthy,
                    status: client.getStatus()
                })
            } catch (error) {
                results.push({
                    name,
                    healthy: false,
                    error: error.message
                })
            }
        }
        return results
    }

    /**
     * @description 断开所有客户端连接
     * @returns {Promise<void>}
     */
    async disconnectAll() {
        const disconnectPromises = []
        for (const [name, client] of this.clients) {
            disconnectPromises.push(
                client.disconnect().catch(error =>
                    logger.error(`断开客户端 ${name} 失败: ${error.message}`)
                )
            )
        }

        await Promise.all(disconnectPromises)
        this.clients.clear()
        logger.info('所有 MCP 客户端已断开连接')
    }

    /**
     * @description 在指定客户端上调用工具
     * @param {string} clientName 客户端名称
     * @param {string} toolName 工具名称
     * @param {Object} args 工具参数
     * @returns {Promise<Object>} 工具调用结果
     */
    async callTool(clientName, toolName, args = {}) {
        const client = this.getClient(clientName)
        if (!client) {
            throw new Error(`客户端 ${clientName} 不存在`)
        }

        return await client.callTool(toolName, args)
    }

    /**
     * @description 在指定客户端上读取资源
     * @param {string} clientName 客户端名称
     * @param {string} uri 资源 URI
     * @returns {Promise<Object>} 资源内容
     */
    async readResource(clientName, uri) {
        const client = this.getClient(clientName)
        if (!client) {
            throw new Error(`客户端 ${clientName} 不存在`)
        }

        return await client.readResource(uri)
    }

    /**
     * @description 获取指定客户端的工具列表
     * @param {string} clientName 客户端名称
     * @returns {Promise<Array>} 工具列表
     */
    async listTools(clientName) {
        const client = this.getClient(clientName)
        if (!client) {
            throw new Error(`客户端 ${clientName} 不存在`)
        }

        return await client.listTools()
    }

    /**
     * @description 获取指定客户端的资源列表
     * @param {string} clientName 客户端名称
     * @returns {Promise<Array>} 资源列表
     */
    async listResources(clientName) {
        const client = this.getClient(clientName)
        if (!client) {
            throw new Error(`客户端 ${clientName} 不存在`)
        }

        return await client.listResources()
    }
}

// 创建全局实例
export const mcpClientManager = new McpClientManager()

// 导出类（用于测试或扩展）
export {McpClientManager}
