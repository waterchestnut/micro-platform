/**
 * @fileOverview 全局变量的初始化
 * @author xianyang 2025/2/8
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

/** 全局变量doc*/
global.resource = global.resource || {}
resource.appName = 'resource.api'
resource.pk = require('./package.json')
resource.baseDir = __dirname + '/'
resource.config = config
resource.tools = tools
resource.module = {}
resource.module.dayjs = dayjs
process.env.NODE_ENV = config.debug ? 'development' : 'production'

fs.readdirSync(resource.baseDir + '/extends').forEach(function (file) {
    if (~file.indexOf('.js')) {
        import('./extends/' + file);
    }
});
