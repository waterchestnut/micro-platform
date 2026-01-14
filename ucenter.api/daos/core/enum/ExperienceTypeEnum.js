/**
 * @fileOverview 经历类型
 * @author xianyang
 * @module
 */
import Enumify from '../../../extends/Enumify.js'

export default class ExperienceTypeEnum extends Enumify {
    static education = new ExperienceTypeEnum('education', '教育')
    static government = new ExperienceTypeEnum('government', '政府部门任职')
    static institution = new ExperienceTypeEnum('institution', '事业单位')
    static enterprise = new ExperienceTypeEnum('enterprise', '企业就业')
    static _ = this.closeEnum()
}