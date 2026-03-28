/**
 * @fileOverview 协议类型
 * @author menglb 2024
 * @module
 */
import Enumify from '../../../extends/Enumify.js'

export default class AgreementTypeEnum extends Enumify {
    static user = new AgreementTypeEnum(1, '用户协议')
    static privacy = new AgreementTypeEnum(2, '隐私协议')
    static _ = this.closeEnum()
}
