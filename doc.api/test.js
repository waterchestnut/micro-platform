/**
 * @fileOverview 临时验证功能
 * @author xianyang 2025/2/8
 * @module
 */

import './init.js'
import {getUserDetail, getUserList, hasPriv} from './grpc/clients/userInfo.js'
import {convertImage} from './grpc/clients/converter.js'
import fs from 'fs'

let buffer = await convertImage(fs.readFileSync('C:\\Users\\menglb\\Downloads\\1199951e6eaa42bd8e8c4bb1c7821f39.emf', {flag: 'r'}), 'PNG')
fs.writeFileSync('1.png', buffer)
