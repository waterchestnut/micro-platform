/**
 * @fileOverview GRPC远程技能命令执行器基类
 * @author xianyang
 * @module
 */

class BaseHandler {

    constructor() {
    }

    /**
     * @description 技能命令执行
     * @param {object} data
     * @param {number} code
     * @param {string} msg
     * @returns {Object} 执行结果，{code: 0[执行后状态], data: '{}'[执行结果值], msg: ''[错误或提示消息]}
     */
    formatData(data, code = 0, msg = '') {
        return {
            code: code,
            data: JSON.stringify(data),
            msg: msg,
        }
    }

    /**
     * @description 技能命令执行
     * @param commandName
     * @param params
     * @param curUserInfo
     * @returns {Promise<Object>} 执行结果，{code: 0[执行后状态], data: null[执行结果值], msg: ''[错误或提示消息]}
     */
    async execCommand(commandName, params, curUserInfo) {
        if (typeof this[commandName] !== 'function') {
            return {
                code: -1,
                msg: `命令 ${commandName} 不存在`,
            }
        }
        return this.formatData(await this[commandName](params, curUserInfo))
    }
}

export default BaseHandler