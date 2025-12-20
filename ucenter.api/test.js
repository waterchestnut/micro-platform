/**
 * @fileOverview 临时验证功能
 * @author xianyang 2024/5/28
 * @module
 */

import './init.js'
import AuthTypeEnum from './daos/core/enum/AuthTypeEnum.js'
import {testRouter} from './services/core/pageConfig.js'
import {genKeyPair} from "./services/core/commonRsa.js";
import * as commonRsa from "./services/core/commonRsa.js";
import {formatHandleAll} from "./services/core/region.js";
import {matchPageConfig} from './services/auth/page.js'

/*
console.log(AuthTypeEnum.managed, AuthTypeEnum.builtIn + '', AuthTypeEnum.toValues(), AuthTypeEnum.toDescriptions())
console.log(await testRouter())*/

/*console.log(genKeyPair())*/

/*let pri=commonRsa.encrypt('123')
console.log(pri)
console.log(commonRsa.decrypt('M2RkYTRmYTkzMjA3NDEzOTBjNTIwNjliOTU1OTliY2I2YmNlZjQzYjVjNWIwYTNiYmIyODNjMmExNWYzNWVmN2IxZjcyMGQzZTVjNDk3YTRmMjlmNTFkYzFmYjEyZmZlMTI1ZGJlZDEzYjIwMTUxMTY0ZThiNjU2MWJmZjY1NzhlZTg3MGJhZWViZDgxODVlMDMwYjI4YWM2ZmNiOTRiNDdiODM3YWFkZjQ5MzRkYTkyZTNiNTNhYzFlMjkwMzM0NDM3MzE1MzBjNDhkYWUxMTUyM2RiYTgzNDZjMjY5MjY3ZTY1ZDFmY2FiMWVkOWFiM2NlY2YxYmY0MGQzYjZkMzM2NTNkZmYxNjJmZmE0YzZmOGE5ZjlkOWNkOTQ2ZWQwYmUxMGVlMmYyY2Y4N2EzNzgxMDYyOTcwYTcwZDBiMGZkOGRiNjgzYjgwMjUzMDhkNjdkOTZmZGUyZmZiNjk0OTBiMWVlZjBiZjkyZDNlNzc5Yzg4NTRiY2M0MjE1ZjA5ZTc1NWYxODc5MTQ4NDRmYmY2NTJkNjhiMTFkODFjMzE2Mjc2ZDI2YTk2OWQ3MWMxYjdiMjMzZDRlNjJjNWViODdlYjI0NDcyNWVlYjM2ZGU1NmUyMjFmNThmNjBmODhhNDdiMWYwZWZhZTA1NjZhZjg3ZmNjZmRhN2RjZTEwOTM='))*/

/*console.log(await matchPageConfig('/ucenter/core/captcha','GET'));*/
