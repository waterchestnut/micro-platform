/**
 * @fileOverview 临时验证功能
 * @author xianyang 2025/2/8
 * @module
 */

import './init.js'
import {getFirstSheetData} from './services/excel/import.js'
import {execResRag} from './services/rag/resource.js'

let ret = await execResRag('内容总监', {
    resCode: 'wms-199-374716406'
})
console.log(ret)
