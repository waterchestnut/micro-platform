/**
 * @fileOverview 全局变量的初始化
 * @author xianyang 2024/5/24
 * @module
 */

import {createRequire} from 'module'
import {fileURLToPath} from 'url'
import path from 'path'
import config from './conf/system.config.js'
import dayjs from 'dayjs'
import * as tools from './tools/index.js'
import fs from 'fs'

const require = createRequire(import.meta.url)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
dayjs.locale('zh-ch')

/** 全局变量ucenter*/
global.ucenter = global.ucenter || {}
ucenter.appName = 'ucenter.api'
ucenter.pk = require('./package.json')
ucenter.baseDir = __dirname + '/'
ucenter.config = config
ucenter.tools = tools
ucenter.module = {}
ucenter.module.dayjs = dayjs
process.env.NODE_ENV = config.debug ? 'development' : 'production'

fs.readdirSync(ucenter.baseDir + '/extends').forEach(function (file) {
    if (~file.indexOf('.js')) {
        import('./extends/' + file);
    }
});
