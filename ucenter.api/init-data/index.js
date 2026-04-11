/**
 * @fileOverview 执行初始化数据
 * @author xianyang
 * @module
 */

import '../init.js'
import {addOrgInfo} from '../services/core/orgInfo.js'
import {addGroup} from '../services/core/group.js'
import {addUserInfo} from '../services/core/userInfo.js'

let schemaCode = 'default'
let orgCode = 'micro'
let groupCode = 'supa'
let userInfo = {
    userCode: 'micro',
    loginName: 'micro',
    realName: '超级管理员',
    pwd: process.env['ADMIN_USER_PASSWORD'] || '34redcRT%^',
    orgCodes: [
        orgCode
    ],
    groupCodes: [
        groupCode
    ]
}

/*默认机构*/
await addOrgInfo(userInfo, {orgCode, orgName: '默认机构'})

/*用户组*/
await addGroup({
    groupName: '超级管理员',
    groupCode: groupCode,
    description: '超级管理员用户组',
    schemaCodes: [schemaCode],
    modulePrivCodes: ['all']
})
await addGroup({
    groupName: '普通注册用户',
    groupCode: 'general-user',
    description: '普通注册用户用户组',
    schemaCodes: [schemaCode],
    modulePrivCodes: []
})

/*超级管理员账号*/
await addUserInfo(userInfo, userInfo, schemaCode, false)

console.log('done')