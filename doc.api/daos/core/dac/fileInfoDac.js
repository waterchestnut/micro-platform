/**
 * @fileOverview 操作mongodb库中的fileInfo
 * @author xianyang
 * @module
 */

import {FileInfo} from '../schema/index.js'
import BaseDac from "./BaseDac.js"
import * as tools from "../../../tools/index.js"

export class FileInfoDac extends BaseDac {
    constructor(Model) {
        super(Model, 'fileCode')
    }

    assembleParams(options) {
        let params = super.assembleParams(options)
        if (options.fileCode) {
            params.$and.push({fileCode: {$eq: options.fileCode}})
        }
        if (options.fileHashCode) {
            params.$and.push({fileHashCode: {$eq: options.fileHashCode}})
        }
        if (options.srcFileCode) {
            params.$and.push({srcFileCode: {$eq: options.srcFileCode}})
        }
        if (options.minioCode) {
            params.$and.push({minioCode: {$eq: options.minioCode}})
        }
        if (tools.isExist(options.fileName)) {
            params.$and.push({fileName: {$regex: new RegExpExt(options.fileName, 'i', true)}})
        }
        return params
    }
}

export default new FileInfoDac(FileInfo)