/**
 * @fileOverview 对话式大模型调用
 * @author xianyang 2025/9/8
 * @module
 */
import BaseHandler from './base.js'
import {OpenAI} from 'openai'
import {addAgentLog} from '../../core/agentLog.js'
import {updateAgentTaskWithLock} from '../../core/agentTask.js'

const tools = llm.tools
const logger = llm.logger
const config = llm.config
const configModels = config.models

class LlmChat extends BaseHandler {
    constructor() {
        super('llm')
    }

    async exec(agentTaskInfo) {
        let llmConfig = configModels[agentTaskInfo.params.llmModel]
        const openai = new OpenAI({
            apiKey: llmConfig.apiKey,
            baseURL: llmConfig.baseURL,
        })
        let createBody = {
            model: llmConfig.model,
            messages: agentTaskInfo.params.llmMessages,
            max_tokens: llmConfig.maxTokens,
            temperature: llmConfig.temperature,
            stream: llmConfig.stream,
            ...agentTaskInfo.params.llmOriginalParams,
        }
        let ret = await openai.chat.completions.create(createBody)
        let handleRet = []
        const updateDuringStream = !!agentTaskInfo?.params?.updateHandleRetDuringStream
        let rawReasoning = ''
        let rawContent = ''
        let lastUpdateAt = 0
        const maybeUpdate = async () => {
            if (Date.now() - lastUpdateAt < 800) return
            lastUpdateAt = Date.now()
            await updateAgentTaskWithLock(agentTaskInfo.agentCode, {
                handleStatus: 1,
                handleRet: {reasoning: rawReasoning, content: rawContent, done: false}
            })
        }
        if (createBody.stream) {
            let buffer = ''

            for await (const chunk of ret) {
                const reasoning = chunk.choices[0]?.delta?.reasoning_content || ''
                const content = chunk.choices[0]?.delta?.content || ''
                if (reasoning) {
                    rawReasoning += reasoning
                }

                buffer += content

                let newlineIndex
                while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                    const line = buffer.slice(0, newlineIndex).trim()
                    buffer = buffer.slice(newlineIndex + 1)

                    if (line) {
                        handleRet.push(`${line}`)
                        addAgentLog(agentTaskInfo, `${line}\n`, 'llmChunk', chunk)
                    }
                }

                if (updateDuringStream) {
                    rawContent += content
                    await maybeUpdate()
                }
            }

            buffer = buffer.trim()
            if (buffer) {
                handleRet.push(`${buffer}`)
                addAgentLog(agentTaskInfo, `${buffer}\n`, 'llmChunk')
            }
        } else {
            if (!ret?.choices?.length) {
                addAgentLog(agentTaskInfo, `大模型没有返回内容`, 'llmEmpty', ret)
            } else {
                handleRet.push(`${ret.choices[0].message.content}`)
                addAgentLog(agentTaskInfo, ret.choices[0].message.content, 'llmResponse', ret)
            }
        }
        return {
            handleStatus: 2,
            handleRet: updateDuringStream
                ? {reasoning: rawReasoning, content: handleRet.join('\n'), done: true}
                : handleRet.join('\n'),
            errorMsg: '',
            subsequentMode: '',
            subsequents: []
        }
    }
}

export default LlmChat