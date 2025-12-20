/**
 * @fileOverview ip相关的操作工具集，包含获取客户端IP，IP范围检查等
 * @module tool/ipHelper
 */

import * as tools from './index.js'

/**
 * @exports tools/ipHelper
 */
const ipHelper = {

    /**
     * @description 获取请求的客户端IP地址列表
     * @param {Request} req 客户端请求对象
     * @returns {Array} 客户端IP列表
     */
    getClientIps: function (req) {
        if (req.ips) {
            return req.ips
        }
        let ipStr = req.ip || '127.0.0.1'
        if (req.headers && req.headers['x-forwarded-for']) {
            ipStr = req.headers['x-forwarded-for']
        } else if (req.socket?.remoteAddress) {
            ipStr = req.socket.remoteAddress
        }

        return ipStr.split(':')
    },

    /**
     * @description 检查IP是否在限定范围内
     * @param {String} sourceIp 待检测IP
     * @param {Array} desIps 有效的IP范围列表
     * @returns {Boolean} 是否在IP范围内
     */
    checkIpInRange: function (sourceIp, desIps) {
        if (!sourceIp || !desIps) {
            return false
        }

        sourceIp = tools.trim(sourceIp, true)
        let arIpSplit = sourceIp.split('.')
        for (let j in desIps) {
            let strPart = desIps[j]
            let arrTmp = strPart.split('/')
            if (arrTmp.length === 1) {
                if (arrTmp[0] === sourceIp)
                    return true
            } else if (arrTmp.length === 2) {
                let ipId = arrTmp[0]
                let strMask = arrTmp[1]
                let arrIpId = ipId.split('.')
                let arrMask = strMask.split('.')

                let bIn = true
                for (let k = 0; k < 4; k++) {
                    let p0 = parseInt(arrIpId[k])
                    let p1 = parseInt(arrMask[k])
                    let p2 = parseInt(arIpSplit[k])

                    if ((p0 & p1) !== (p1 & p2)) {
                        bIn = false
                        break
                    }
                }
                if (bIn)
                    return true
            }
        }
        return false
    }
}

export default ipHelper