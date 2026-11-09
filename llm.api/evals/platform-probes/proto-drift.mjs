/**
 * @fileOverview 双份 proto 的漂移检查（PR-R0 的前置债，D61②）
 * @module evals/platform-probes/proto-drift
 * @description
 * llm.api 的 `grpc/clients/userInfo.proto` 是 ucenter `grpc/servers/userInfo.proto` 的**副本**。
 * 副本本身不是错——gRPC 客户端只需要声明自己要调的方法；真正的问题是**没有东西守着它**：
 * 服务端加了方法而客户端副本没同步，编译期与测试期都不报错，直到运行时才 `UNIMPLEMENTED`。
 * 本脚本把这种漂移变成退出码非零。
 *
 * 检查两件事：
 * 1. 客户端声明的每个 rpc 都必须存在于服务端（**子集关系**：客户端只声明自己要调的是合理的）；
 * 2. 关键 rpc 必须**两边都在**（PR-R0 的 `getMentorStudents` / `getMentorTeachers`）：
 *    子集关系对"服务端先删方法"是瞎的，而那恰好是破坏调用方的方向。
 *
 * 用法：
 *   node evals/platform-probes/proto-drift.mjs
 *   # ucenter 不在默认位置时显式指路：
 *   $env:UCENTER_USERINFO_PROTO='D:\\path\\to\\xxzx.ucenter.api\\src\\grpc\\servers\\userInfo.proto'
 *
 * **这是单仓之外的检查**：ucenter 不在同一台机器/同一条流水线上时脚本直接跳过并说明原因，
 * 不伪装成"检查通过"。真正的 CI 保证需要跨仓 checkout 或把 proto 抽成共享包（Q-7，未决）。
 */
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CLIENT_PROTO = path.resolve(__dirname, '../../grpc/clients/userInfo.proto')
const SERVER_PROTO_CANDIDATES = [
    process.env.UCENTER_USERINFO_PROTO,
    '../../../../xxzx.ucenter.api/src/grpc/servers/userInfo.proto',
    'D:/workspace/xxzx/xxzx.ucenter.api/src/grpc/servers/userInfo.proto',
].filter(Boolean)

/**
 * @description 从 proto 文本里取出某个 service 声明的 rpc 名集合
 * @param {String} text proto 文件内容
 * @param {String} serviceName 服务名（如 UserInfo）
 * @returns {String[]} rpc 名列表（按声明顺序）
 */
function extractRpcs(text, serviceName) {
    const svc = new RegExp(`service\\s+${serviceName}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm').exec(text)
    if (!svc) {
        return []
    }
    return [...svc[1].matchAll(/^\s*rpc\s+(\w+)\s*\(/gm)].map(m => m[1])
}

/**
 * @description 从 proto 文本里取出所有 message 名集合
 * @param {String} text proto 文件内容
 * @returns {String[]} message 名列表
 */
function extractMessages(text) {
    return [...text.matchAll(/^\s*message\s+(\w+)\s*\{/gm)].map(m => m[1])
}

const out = (note, obj = {}) => console.log(JSON.stringify({probe: 'proto-drift', note, ...obj}))

const clientText = fs.readFileSync(CLIENT_PROTO, 'utf8')
const serverPath = SERVER_PROTO_CANDIDATES.find(p => fs.existsSync(p))
if (!serverPath) {
    out('跳过：本机找不到 ucenter 的 userInfo.proto，跨仓检查需要两个仓都在（Q-7 未决前这是硬限制）',
        {client: CLIENT_PROTO, 找过: SERVER_PROTO_CANDIDATES})
    process.exit(0)
}

const serverText = fs.readFileSync(serverPath, 'utf8')
const clientRpcs = extractRpcs(clientText, 'UserInfo')
const serverRpcs = extractRpcs(serverText, 'UserInfo')
const clientMsgs = extractMessages(clientText)
const serverMsgs = extractMessages(serverText)

const REQUIRED_BOTH = ['getMentorStudents', 'getMentorTeachers']
const missingOnServer = clientRpcs.filter(r => !serverRpcs.includes(r))
const requiredMissing = REQUIRED_BOTH.filter(r => !serverRpcs.includes(r) || !clientRpcs.includes(r))
const msgMissingOnServer = clientMsgs.filter(m => !serverMsgs.includes(m))

const failed = []
if (missingOnServer.length) {
    failed.push(`客户端声明但服务端没有的 rpc：${missingOnServer.join(', ')}`)
}
if (requiredMissing.length) {
    failed.push(`两侧必须都有但缺失：${requiredMissing.join(', ')}`)
}
if (msgMissingOnServer.length) {
    failed.push(`客户端引用但服务端没有的 message：${msgMissingOnServer.join(', ')}`)
}

out(failed.length ? '❌ 漂移' : '✅ 无漂移', {
    server: serverPath,
    客户端rpc: clientRpcs,
    服务端rpc: serverRpcs,
    服务端独有: serverRpcs.filter(r => !clientRpcs.includes(r)),
    判定: failed.length ? failed.join('；') : '客户端是服务端的子集，且 PR-R0 的两个 rpc 两侧都在',
})
process.exit(failed.length ? 1 : 0)
