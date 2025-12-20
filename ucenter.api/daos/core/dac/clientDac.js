/**
 * @fileOverview 操作mongodb库中的client
 * @author xianyang
 * @module
 */

import {Client} from '../schema/index.js'
import BaseDac from "./BaseDac.js"
import * as tools from "../../../tools/index.js"

export class ClientDac extends BaseDac {
    constructor(Model) {
        super(Model, 'clientCode')
    }

    assembleParams(options) {
        let params = super.assembleParams(options)
        if (tools.isArray(options.clientCode)) {
            params.$and.push({clientCode: {$in: options.clientCode}})
        } else if (options.clientCode) {
            params.$and.push({clientCode: options.clientCode})
        }
        if (tools.isExist(options.clientName)) {
            params.$and.push({clientName: {$regex: new RegExpExt(options.clientName, 'i', true)}})
        }
        if (tools.isExist(options.retUrls)) {
            params.$and.push({retUrls: {$regex: new RegExpExt(options.retUrls, 'i', true)}})
        }
        return params
    }
}

export default new ClientDac(Client)