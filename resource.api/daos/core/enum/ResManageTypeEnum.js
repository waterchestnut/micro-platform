/**
 * @fileOverview 资源管理类型
 * @author xianyang
 * @module
 */
import Enumify from '../../../extends/Enumify.js'

export default class ResManageTypeEnum extends Enumify {
    static union = new ResManageTypeEnum('union', '联盟提供的共享资源')
    static platform = new ResManageTypeEnum('platform', '机构内的共享资源')
    static self = new ResManageTypeEnum('self', '用户自定义上传的资源')
    static literature = new ResManageTypeEnum('literature', '文献阅读引入的资源')
    static _ = this.closeEnum()
}