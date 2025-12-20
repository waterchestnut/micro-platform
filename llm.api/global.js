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
global.llm = global.llm || {}
llm.appName = 'llm.api'
llm.pk = require('./package.json')
llm.baseDir = __dirname + '/'
llm.config = config
llm.tools = tools
llm.module = {}
llm.module.dayjs = dayjs
process.env.NODE_ENV = config.debug ? 'development' : 'production'

fs.readdirSync(llm.baseDir + '/extends').forEach(function (file) {
    if (~file.indexOf('.js')) {
        import('./extends/' + file);
    }
});
