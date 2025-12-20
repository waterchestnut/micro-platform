/**
 * @fileOverview 机构类型
 * @author xianyang 2024/5/19
 * @module
 */
import Enumify from '../../../extends/Enumify.js'

export default class OrgTypeEnum extends Enumify {
    static other = new OrgTypeEnum('other', '其他')
    static school = new OrgTypeEnum('school', '学校')
    static arbitration = new OrgTypeEnum('arbitration', '仲裁机构')
    static court = new OrgTypeEnum('court', '法院')
    static legal = new OrgTypeEnum('legal', '法人或其他组织')
    static _ = this.closeEnum()
}