/**
 * @fileOverview 统计消息检索
 * @module
 */

import BaseSearch from '../base/index.js'
import * as mapping from './mapping.js'
import dayjs from 'dayjs'
import ipaddr from 'ipaddr.js'
import {isString} from '../../../tools/index.js'

const tools = statistic.tools

export class MsgSearch extends BaseSearch {
    constructor() {
        super('msg')
    }

    getMapping() {
        return mapping
    }

    formatItem(retItem, item, textMaxWords) {
        return null
    }

    async updateIndex(dataList) {
        if (!dataList?.length) {
            return {code: -1, msg: '没有要更新的信息'}
        }
        let jsonDocs = ''
        for (let i = 0; i < dataList.length; i++) {
            let item = dataList[i]
            let doc = await this.getDoc(item)
            jsonDocs += this.getUpdateJson(doc)
        }
        if (jsonDocs) {
            await this.updateDocs(jsonDocs)
        }
        return {code: 0}
    }

    async getDetail(msgCode) {
        return super.getDetail(this._configKey + '_' + msgCode)
    }

    async getDoc(msgInfo) {
        let doc = {
            ukey: this._configKey + '_' + msgInfo.msgCode,
            key_msgCode: msgInfo.msgCode,
            key_sysCode: msgInfo.sysCode,
            key_sysName: msgInfo.sysName,
            key_operateType: msgInfo.operateType,
            date_browseTime: msgInfo.browseTime ? msgInfo.browseTime : null,
            key_browseTimeStr: msgInfo.browseTimeStr,
            key_userCode: msgInfo.userCode,
            key_realName: msgInfo.realName,
            key_orgCode: msgInfo.orgCode,
            key_ip: msgInfo.ip,
            key_url: msgInfo.url,
            key_referrer: msgInfo.referrer,
            key_cookieId: msgInfo.cookieId,
            key_lang: msgInfo.lang,
            key_userAgent: msgInfo.userAgent,
            long_status: msgInfo.status || 0,
            key_clientCode: msgInfo.clientCode,
            key_clientName: msgInfo.clientName,
            key_title: msgInfo.title,
            text_cn_title: msgInfo.title,
            text_cn_smart_title: msgInfo.title,
        }
        if (msgInfo.ip && ipaddr.isValid(msgInfo.ip)) {
            doc.ip_ip = msgInfo.ip
        } else {
            doc.ip_ip = null
        }
        if (msgInfo.content) {
            let obj = {}
            for (let key in msgInfo.content) {
                obj[key] = isString(msgInfo.content[key]) ? msgInfo.content[key] : JSON.stringify(msgInfo.content[key])
            }
            doc.nested_content = obj
            doc.text_cn_smart_content_msg = msgInfo.content.msg ? (msgInfo.content.msg + '') : null
        } else {
            doc.nested_content = null
            doc.text_cn_smart_content_msg = null
        }
        appendUrlAttrs(msgInfo.url, 'url', doc)
        appendUrlAttrs(msgInfo.url, 'referrer', doc)
        return doc
    }
}

function appendUrlAttrs(urlStr, key, doc) {
    const emptyAttrs = () => {
        ['host', 'protocol', 'port', 'pathname', 'search'].forEach(subKey => {
            doc[`key_${key}_${subKey}`] = null
        })
    }
    const assignAttrs = (urlObj) => {
        ['host', 'protocol', 'port', 'pathname', 'search'].forEach(subKey => {
            doc[`key_${key}_${subKey}`] = urlObj[subKey]
        })
    }
    if (!urlStr) {
        return emptyAttrs()
    }
    try {
        let urlObj = new URL(urlStr)
        return assignAttrs(urlObj)
    } catch (e) {
        return emptyAttrs()
    }
}

export default new MsgSearch()