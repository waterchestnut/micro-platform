/**
 * @fileOverview 真 gRPC 栈下的截止验证：deadline 到点会不会真的把调用打死
 * @module evals/platform-probes/grpc-deadline-probe
 * @description
 * `test/grpc/clients/userInfoDeadline.test.js` 用的是**假 client**：它证明了我按 grpc-js 的
 * 四参形态把 `options.deadline` 传下去了，但**没有证明 grpc-js 会因为它中断一次不返回的调用**。
 * 而 mentorContact 的 fail-closed 完全押在这句话上，所以必须用真 server 再验一次。
 *
 * 做法：用同一个 proto 起一个假 ucenter，`getMentorTeachers` 故意 sleep 到远超截止，
 * 然后按真截止打过去，看它是不是在截止处报错（code=4 DEADLINE_EXCEEDED）。
 *
 * 用法（在 `src/` 下）：node evals/platform-probes/grpc-deadline-probe.mjs
 */
import grpc from '@grpc/grpc-js'
import protoLoader from '@grpc/proto-loader'
import path from 'node:path'
import fs from 'node:fs'
import {fileURLToPath} from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(__dirname, '../..')
const PROTO = path.join(SRC, 'grpc/clients/userInfo.proto')
const TIMEOUT_MS = 400
const HANG_MS = 3000

const log = (note, obj) => console.log(JSON.stringify({probe: 'grpc-deadline', note, ...obj}))

const pkgDef = protoLoader.loadSync(PROTO, {
    keepCase: true, longs: String, enums: String, defaults: true, oneofs: true,
})
const ucenter = grpc.loadPackageDefinition(pkgDef).ucenter

/**
 * @description 一个"接了但不返回"的假 ucenter
 * @param {Number} port 端口
 * @returns {Promise<Number>} 实际端口
 */
function startHangingServer(port) {
    const server = new grpc.Server()
    /**
     * @description 故意不回调：模拟 ucenter 卡住（连接正常、服务不返回）
     * @param {Object} call 请求
     * @param {Function} callback 响应回调（这里永远不调）
     * @returns {void}
     */
    server.addService(ucenter.UserInfo.service, {
        getMentorTeachers(call, callback) {
            log('服务端收到请求，故意挂起', {userCode: call.request.userCode, 挂起ms: HANG_MS})
            setTimeout(() => callback(null, {userCodes: ['LATE']}), HANG_MS)
        },
    })
    return new Promise((resolve, reject) => {
        server.bindAsync(`127.0.0.1:${port}`, grpc.ServerCredentials.createInsecure(), (err, bound) => {
            if (err) {
                return reject(err)
            }
            resolve({bound, server})
        })
    })
}

const {bound: PORT, server} = await startHangingServer(0)
const client = new ucenter.UserInfo(`127.0.0.1:${PORT}`, grpc.credentials.createInsecure())
log('假 ucenter 已起', {port: PORT})

/**
 * @description 与 grpc/clients/userInfo.js 里同一形态的调用（四参 + options.deadline）
 * @param {Number} timeoutMs 截止
 * @returns {Promise<Object>} 结果或错误
 */
function callWithDeadline(timeoutMs) {
    return new Promise(resolve => {
        const t0 = Date.now()
        client.getMentorTeachers({userCode: 'U-PROBE'}, new grpc.Metadata(),
            {deadline: new Date(Date.now() + timeoutMs)},
            (err, response) => resolve({
                elapsed: Date.now() - t0,
                err: err ? {code: err.code, message: String(err.message).slice(0, 80)} : null,
                response: response ? (response.userCodes || []) : null,
            }))
    })
}

const got = await callWithDeadline(TIMEOUT_MS)
/** 反面对照：截止给到大于挂起时长，应当拿到响应（证明"失败"不是网络不通造成的） */
const control = await callWithDeadline(HANG_MS + 1500)

await new Promise(r => server.tryShutdown(() => r()))

log('结果', {截止ms: TIMEOUT_MS, 实际: got, 对照: control})
const deadlineWorked = got.err?.code === 4 && got.elapsed < HANG_MS
const controlWorked = !control.err && control.response?.includes('LATE')
log('判定', {
    截止生效: deadlineWorked,
    对照通过: controlWorked,
    结论: deadlineWorked && controlWorked
        ? `✅ grpc-js 的 options.deadline 真能把"接了不返回"的调用在 ${got.elapsed}ms 打死（code=4），`
            + '而同一条链路放宽截止后能正常拿到响应 ⇒ mentorContact 的 fail-closed 有了可靠的触发条件'
        : (deadlineWorked
            ? '⚠️ 截止生效但对照失败：说明这条链路本来就不通，"截止生效"可能是假阳性'
            : `❌ 截止没生效（elapsed=${got.elapsed}ms, err=${JSON.stringify(got.err)}）⇒ fail-closed 押在这条形上就是押空，`
                + '需要改用 call.cancel() 或 Promise.race 兜底'),
})
process.exit(deadlineWorked && controlWorked ? 0 : 1)
