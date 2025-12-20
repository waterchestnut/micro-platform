/**
 * @fileOverview 应用类型
 * @author xianyang
 * @module
 */
import Enumify from '../../../extends/Enumify.js'

export default class ClientTypeEnum extends Enumify {
    static builtIn = new ClientTypeEnum('builtIn', '平台内置的应用')
    static official = new ClientTypeEnum('official', '官方维护的应用')
    static thirdParty = new ClientTypeEnum('thirdParty', '第三方维护的应用')
    static selfBuild = new ClientTypeEnum('selfBuild', '机构自建的应用')
    static community = new ClientTypeEnum('community', '社区开源的应用')
    static _ = this.closeEnum()
}