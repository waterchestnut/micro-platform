/**
 * @fileOverview 操作mongodb库中的skillJournal
 * @module daos/core/dac/skillJournalDac
 * @description
 * 远程技能治理（PR-E0.1 ⑦）的只追加留痕。
 * 与 `memoryJournalDac` 同形（继承 BaseDac、主键 journalCode），差别只在过滤字段是 `skillCode`。
 */

import {SkillJournal} from '../schema/index.js'
import BaseDac from './BaseDac.js'

export class SkillJournalDac extends BaseDac {
    constructor(Model) {
        super(Model, 'journalCode')
    }

    /**
     * @description 组装查询条件
     * @param {Object} options 过滤项
     * @returns {Object} 条件
     */
    assembleParams(options) {
        let params = super.assembleParams(options)
        if (options.skillCode) {
            params.$and.push({skillCode: {$eq: options.skillCode}})
        }
        if (options.op) {
            params.$and.push({op: {$eq: options.op}})
        }
        if (options.actor) {
            params.$and.push({actor: {$eq: options.actor}})
        }
        return params
    }
}

const skillJournalDac = new SkillJournalDac(SkillJournal)

export default skillJournalDac
