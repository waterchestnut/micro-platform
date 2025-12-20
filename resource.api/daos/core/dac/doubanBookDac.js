/**
 * @fileOverview 操作mongodb库中的doubanBook
 * @module
 */

import {DoubanBook} from '../schema/index.js'
import BaseDac from "./BaseDac.js"
import * as tools from "../../../tools/index.js"

export class DoubanBookDac extends BaseDac {
    constructor(Model) {
        super(Model, 'resCode')
    }

}

export default new DoubanBookDac(DoubanBook)