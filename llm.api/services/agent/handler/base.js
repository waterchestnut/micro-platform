/**
 * @fileOverview 智能体执行器基类
 * @author xianyang 2025/9/8
 * @module
 */

class BaseHandler {
    _defaultAgentType

    constructor(defaultAgentType) {
        this._defaultAgentType = defaultAgentType
    }

    /**
     * @description 智能体任务执行
     * @param {Object} agentTaskInfo 任务信息
     * @returns {Promise<Object>} 执行结果，{handleStatus: 0[执行后状态], handleRet: null[执行结果值], errorMsg: ''[错误提示], subsequentMode: 'sequential'[子任务并串行模式：sequential、parallel], subsequents: [][后续要继续执行的子任务]}
     */
    async exec(agentTaskInfo) {
        return {
            handleStatus: 0,
            handleRet: null,
            errorMsg: '',
            subsequentMode: 'sequential',
            subsequents: []
        }
    }
}

export default BaseHandler