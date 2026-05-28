/**
 * @fileOverview CARSI用户关联映射的数据操作类
 * @author
 * @module
 */

import {CarsiUser} from '../schema/index.js'
import BaseDac from './BaseDac.js'

export class CarsiUserDac extends BaseDac {
    constructor(Model) {
        super(Model, 'eppn')
    }

    async getByEppn(eppn) {
        return this.getOneByFilter({eppn})
    }

    async getByUserCode(userCode) {
        return this.getOneByFilter({userCode})
    }
}

export default new CarsiUserDac(CarsiUser)