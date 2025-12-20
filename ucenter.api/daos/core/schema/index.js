/**
 * @fileOverview 初始化连接、集成所有mongodb的schema
 * @author xianyang 2024/5/31
 * @module
 */

import mongoose from 'mongoose'
import userInfoSchema from './userInfoSchema.js'
import moduleSchema from './moduleSchema.js'
import modulePrivSchema from './modulePrivSchema.js'
import departmentSchema from './departmentSchema.js'
import groupSchema from './groupSchema.js'
import jobSchema from './jobSchema.js'
import orgInfoSchema from './orgInfoSchema.js'
import regionSchema from './regionSchema.js'
import clientSchema from './clientSchema.js'
import accessTokenSchema from './accessTokenSchema.js'
import authCodeSchema from './authCodeSchema.js'
import pageConfigSchema from './pageConfigSchema.js'
import refreshTokenSchema from './refreshTokenSchema.js'
import mobileRangeSchema from './mobileRangeSchema.js'

const mongodbConfig = ucenter.config.mongodbConfig

async function getConnection(config) {
    for (let i = 1; i <= 3; ++i) {
        try {
            return await mongoose.createConnection(config.uri, config.options)
        } catch (err) {
            ucenter.logger.error(`第${i}次connect to %s error: ${mongodbConfig.uri}，${err.message}`)
            if (i >= 3) {
                process.exit(1)
            }
        }
    }
}

/**
 * 连接mongodb并导出Model
 */
const conn = await getConnection(mongodbConfig)

export const UserInfo = conn.model('UserInfo', userInfoSchema, 'userInfo')
export const Module = conn.model('Module', moduleSchema, 'module')
export const ModulePriv = conn.model('ModulePriv', modulePrivSchema, 'modulePriv')
export const Department = conn.model('Department', departmentSchema, 'department')
export const Group = conn.model('Group', groupSchema, 'group')
export const Job = conn.model('Job', jobSchema, 'job')
export const OrgInfo = conn.model('OrgInfo', orgInfoSchema, 'orgInfo')
export const Region = conn.model('Region', regionSchema, 'region')
export const Client = conn.model('Client', clientSchema, 'client')
export const AccessToken = conn.model('AccessToken', accessTokenSchema, 'accessToken')
export const AuthCode = conn.model('AuthCode', authCodeSchema, 'authCode')
export const PageConfig = conn.model('PageConfig', pageConfigSchema, 'pageConfig')
export const RefreshToken = conn.model('RefreshToken', refreshTokenSchema, 'refreshToken')
export const MobileRange = conn.model('MobileRange', mobileRangeSchema, 'mobileRange')