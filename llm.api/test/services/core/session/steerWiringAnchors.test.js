/**
 * @fileOverview PR-D commit 2（soft steer）接线的源码锚用例
 * @module test/services/core/session/steerWiringAnchors
 * @description
 * 主循环深处的注入块没法用假件喂进 execChat（2000 行外部依赖重镇），按 segmentEvents/llmTraceArgs
 * 的先例用**源码锚**钉装配清单。这里钉的不是"存在"，全是**顺序与配对**——它们错了功能照样"能跑"：
 * 注入挪到 `scheduleCp('postTools')` 之后 ⇒ 检查点里没有插话，崩溃续跑把已消费的插话再灌一遍；
 * persistTurn 与 saveMessage 只加一侧 ⇒ extInfoPassthrough 点名过的"看起来接好了"漏接形状；
 * 路由从 body 收 userCode ⇒ 冒充插话。每一条都是"没红但错"的候选。
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r/g, '')

describe('1 llmChat 边界注入', () => {
    const src = read('services/core/llmChat.js')
    test('注入位置：toolResults 并入之后、postTools 检查点之前（顺序错了=续跑双注入）', () => {
        /** 2b 后 pullBoundary/push 各有两处（打断现场+边界）——本锚说的是**边界注入**这条的顺序，
         *  从 merge 起点向后逐个找，别拿打断现场的先行出现做判据（那是 describe 4 的事） */
        const iMerge = src.indexOf('for (const toolResult of toolResults)')
        const iPull = src.indexOf('options.runMailbox.pullBoundary', iMerge)
        const iPush = src.indexOf("messages.push({role: 'user', content: block})", iPull)
        const iCp = src.indexOf("scheduleCp('postTools'", iPush)
        assert.ok(iMerge >= 0 && iPull >= 0 && iPush >= 0 && iCp >= 0, '四个锚点必须都在（llmChat 形状变了要重写本文件）')
        assert.ok(iPull > iMerge && iPush > iPull && iCp > iPush, '边界注入必须在工具并入之后、postTools 检查点之前')
    })
    test('注入异常被兜住：主循环不许因为一块插话炸掉', () => {
        const iTry = src.indexOf('if (options.runMailbox) {')
        const seg = src.slice(iTry, iTry + 2200)
        assert.ok(/try\s*\{/.test(seg) && /catch\s*\(/.test(seg), 'runMailbox 块必须有 try/catch 包裹')
        /** 守卫本体也要钉住：只测"块内顺序"的话，把 `if (options.runMailbox)` 改成 `if (false)` 全部锚照样绿——顺序锚测不到"整块被短路" */
        assert.match(src, /if \(options\.runMailbox\) \{\s*\n\s*try \{/, '注入必须挂在 runMailbox 守卫之后、try 之前（守卫+兜底成对出现）')
    })
    test('steer_ack 经 streamCallback 下发且带 injectAt 事实', () => {
        assert.ok(/steerAckPayload\(s, \{injectAt: 'postTools', abortCurrentStream: false\}\)/.test(src), 'ack 必须如实标 postTools/不 abort（soft 语义）')
        assert.ok(src.includes("}), 'steer_ack')"), '事件名逐字 steer_ack')
    })
    test('steerings 落档两侧齐：persistTurn 清单 + saveMessage 白名单（extInfoPassthrough 点名的形状）', () => {
        assert.ok(src.includes('steerings: steeringsArchive.length ? steeringsArchive : null'), 'persistTurn 侧缺位 ⇒ 承诺了字段但库里永远没有')
        assert.ok(src.includes('steerings: options.steerings'), 'saveMessage 白名单缺位 ⇒ 算了也没落库')
    })
})

describe('2 root.js 装配', () => {
    const src = read('routes/core/chat/root.js')
    test('steerEnabled ⇒ 建邮箱、把手带 onSteer、订阅端拿到 steer 入口（三件成套）', () => {
        const iBlock = src.indexOf('const stopOn = ctlCfg.stopEnabled')
        assert.ok(iBlock >= 0, '找不到控制接线块')
        const seg = src.slice(iBlock, iBlock + 3800)
        assert.ok(seg.includes('SB.createRunMailbox('), 'steerEnabled 开了不建邮箱 = /steer 投给空气')
        assert.ok(seg.includes('onSteer: runMailbox ? (payload) => runMailbox.push(payload) : undefined'), '把手必须把消息送进 push（唯一的入队闸）')
        assert.ok(seg.includes('takeSteerHandle: RC.takeSteerHandle'), '订阅端没接 takeSteerHandle ⇒ steer 永远 not-my-run')
        assert.ok(src.includes('runMailbox,'), 'execChat options 必须带上邮箱')
    })
    test('hard 置位三闸齐：mode=hard ∧ hardSteerEnabled ∧ active（缺 active 就是工具期误伤下一窗）', () => {
        const iBlock = src.indexOf('hardSteer = {flag: null, active: false}')
        assert.ok(iBlock >= 0, 'root 未构造停止位对象')
        const seg = src.slice(iBlock, iBlock + 1200)
        assert.ok(seg.includes("s.mode === 'hard'"), 'soft 不许置位')
        assert.ok(seg.includes('ctlCfg.hardSteerEnabled === true'), '未开闸不许置位（与路由 400 同判据的兜底闸）')
        assert.ok(seg.includes('hardSteer.active'), '生成窗闸缺位 = 本提交最阴的错')
        assert.ok(seg.includes("hardSteer.flag = 'hard-steer'"), '置的位必须与 llmChat 打断分支的等值判据同名')
        assert.ok(src.includes('hardSteer,'), 'execChat options 必须带上停止位')
    })
    test('/steer 路由：说话人取身份不取 body（防冒充），判序"归属在前内容在后"（防存在性探测）', () => {
        const iRoute = src.indexOf("fastify.post('/steer'")
        const iEnd = src.indexOf("fastify.post('/runStats'")
        assert.ok(iRoute >= 0 && iEnd > iRoute, '找不到 /steer 路由体')
        const route = src.slice(iRoute, iEnd)
        assert.ok(route.includes('const {messageCode, text, mode, steerCode} = request.reqParams'), 'body 解构清单里不许出现 userCode/realName')
        const iNorm = route.indexOf('normalizeSteerMessage')
        const iLedger = route.indexOf('findProcessingByMessageCode')
        const iForbidden = route.indexOf('无法插话该轮')
        assert.ok(iLedger < iForbidden && iForbidden < iNorm, '判序错位：内容校验跑到归属核验之前会造出存在性探测器')
        assert.ok(route.includes('userCode: request.userInfo.userCode'), 'normalize 的 userCode 必须来自身份')
    })
    test('runStats 只报聚合把手数（不泄露 messageCode/userCode）', () => {
        const iStats = src.indexOf("fastify.post('/runStats'")
        const seg = src.slice(iStats, iStats + 3000)
        assert.ok(seg.includes('stopHandles: ctlSnap.handles') && seg.includes('steerHandles: ctlSnap.steerHandles'))
        assert.ok(!seg.includes('.byUser'), '视图侧枚举泄露的老账不许翻回来')
    })
})

describe('5 ask_user/answer 装配面（commit 3）', () => {
    const chat = read('services/core/llmChat.js')
    const loop = read('services/core/llmLoop.js')
    test('注册双闸：配置开 ∧ 本 run 有 router（"能问不能答=挂死 run"从注册点关死）', () => {
        assert.ok(chat.includes('askToolEnabled(askCfg) && !!options.answerRouter'), '注册门槛必须是双闸')
        assert.ok(chat.includes('allTools.push(...buildAskTools())'))
    })
    test('classify：ask 谓词只在 askOn 时注入；otherCalls 取反串带上 isAsk（漏判=丢给 mcpToolManager 找不到实现）', () => {
        assert.ok(chat.includes('...(askOn ? {isAskTool} : {})'), '关着时连分类都不变（默认关逐字一致的纪律）')
        assert.ok(loop.includes('!isArtifact(tc.function?.name) && !isAsk(tc.function?.name)'), '取反串漏 isAsk ⇒ ask 调用会双写或错道')
        assert.ok(loop.includes('askCalls, otherCalls'), 'classify 返回清单要有 askCalls')
    })
    test('执行分支：未启用的兜底回错误给模型（到不了也要可见）；toolResults 合并含 askResults', () => {
        assert.ok(chat.includes("'ask_user 未启用'"), '兜底分支不许静默吞调用')
        assert.ok(chat.includes('...planResults, ...artifactResults, ...askResults,'), 'askResults 不并入 toolResults ⇒ tool 消息缺应答，下一轮 API 直接 400（锚定中段，不锁首位变量名——门 choke 点在最前面加了 gateBlockedResults，锁头部会误报）')
        assert.ok(chat.includes('checkpointSeq: iterationCount'), 'await_input 的断点号取本轮迭代数')
    })
    test('root：router 三件套建挂传 + /answer 判序（开签→账本→kind 预检→投递，被拒三情形同一条 403）', () => {
        const src = read('routes/core/chat/root.js')
        assert.ok(src.includes('answerRouter = AT.createAnswerRouter({'), 'router 未建')
        assert.ok(src.includes('onAnswer: answerRouter ? (payload) => answerRouter.deliver(payload) : undefined'), '把手未挂 deliver 口')
        assert.ok(src.includes('takeAnswerHandle: RC.takeAnswerHandle'), '订阅端未接 answer 入口')
        assert.ok(src.includes('answerRouter,'), 'options 未传 router')
        const iRoute = src.indexOf("fastify.post('/answer'")
        const iEnd = src.indexOf("fastify.post('/runStats'")
        const route = src.slice(iRoute, iEnd)
        const iOpen = route.indexOf('openRequestState')
        const iLedger = route.indexOf('findProcessingByMessageCode')
        const iAdm = route.indexOf('decideAnswerAdmission')
        const iPub = route.indexOf('publishAnswer')
        assert.ok(iOpen >= 0 && iOpen < iLedger && iLedger < iAdm && iAdm < iPub, '判序：凭证（签名）最先，账本 owner 次之，kind 预检再次，最后投递')
        assert.ok(route.includes('if (!adm.admit) {'), '预检结果必须被使用——只调不判=装饰性接线')
        /** 文案单源（refuse 工厂）比"复制三遍同一句"更强：定义只许一处，出口至少三处——复制才是漂移温床 */
        assert.equal((route.match(/const refuse = /g) || []).length, 1, 'refuse 文案源必须唯一')
        const refuses = (route.match(/return refuse\(\)/g) || []).length
        assert.ok(refuses >= 3, '被拒出口（凭证坏/owner 不符/kind 预检）必须全走 refuse()；实际 ' + refuses)
        assert.equal((route.match(/无法处理该答复/g) || []).length, 1, '字面量出现第二次就说明有人开始复制文案')
        assert.ok(route.includes('信密封里的 runCode') || route.includes('state.runCode'), '路由目标取密封串里的 runCode，不取 body 自报')
        /** 结构上焊死"给别人的 run 投答复"：整条路由里 body 不许出现 runCode 字段 */
        assert.ok(!/reqParams[^\n]*runCode/.test(route), 'runCode 只能来自已验签的 state——从 body 读它就是投递目标伪造面')
        assert.ok(route.includes('findProcessingByMessageCode(state.runCode)') && route.includes('messageCode: state.runCode'), '查账与投递必须同一个 state.runCode（两处不同源=查的是 A 投的是 B）')
        assert.ok(src.includes('answerHandles: ctlSnap.answerHandles'), 'runStats 要能看见 answer 挂点数（看不见=没接线）')
    })
    test('config：askEnabled 默认 false + askTimeoutMs 给足人的作答时间', () => {
        const cfgSrc = read('conf/system.config.js')
        assert.ok(cfgSrc.includes("askEnabled: process.env['control_askEnabled'] === 'true'"))
        assert.ok(cfgSrc.includes('askTimeoutMs'))
    })
})

describe('6 纯件纪律（ask 面）', () => {
    test('askUserTool 不碰 redis/路由（传输在 runControl，路由在 root——分层与 mailbox 同构）', () => {
        const code = read('services/core/session/askUserTool.js')
            .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
        assert.ok(!/publish\(|psubscribe|ioredis|fastify/.test(code), '传输面不许混进 router')
        assert.ok(code.includes("from './mrtrPayload.js'"), '判据必须单源复用，不许就地重写')
    })
})

describe('3 config 与默认关', () => {
    const cfgSrc = read('conf/system.config.js')
    test('steerEnabled 默认 false（env 字符串比对，不是宽松真值）', () => {
        assert.ok(cfgSrc.includes("steerEnabled: process.env['control_steerEnabled'] === 'true'"))
    })
    test('hardSteerEnabled 独立开关且默认 false（soft 开闸不隐含 hard）', () => {
        assert.ok(cfgSrc.includes("hardSteerEnabled: process.env['control_hardSteerEnabled'] === 'true'"))
    })
    test('队列参数成组给全（邮箱容量/边界限量/陈旧线）', () => {
        for (const key of ['steerMaxQueue', 'steerBoundaryLimit', 'steerExpiryMs']) {
            assert.ok(cfgSrc.includes(key), `controlConfig.${key} 缺位`)
        }
    })
})

describe('4 hard steer 打断面（commit 2b：停止位方案，非 AbortController）', () => {
    const src = read('services/core/llmChat.js')
    test('打断分支在终态早停分支之前——写反了 hard 会被终态吃掉变成静默 abort', () => {
        const iHard = src.indexOf("drained.stopped === 'hard-steer'")
        const iTerminal = src.indexOf('const rescued = liveAnswerMerged')
        assert.ok(iHard >= 0, 'hard-steer 打断分支不在（llmChat 形状变了要重写本文件）')
        assert.ok(iTerminal > iHard, '顺序判据：终态分支的正文并入在打断分支之后才说明打断在前')
        /** 守卫逐字钉（S7 教训的 2b 版）：只测位置测不到"守卫被 && false 静默拆掉"——结构断言+字面量缺一不可 */
        assert.ok(src.includes("if (drained.stopped === 'hard-steer' && options.hardSteer && options.runMailbox) {"), '守卫字面量漂移')
    })
    test('生成窗 arm/disarm 成对（disarm 必须在 finally——create 抛错时旗不能漏进下一窗）', () => {
        assert.ok(src.includes('options.hardSteer.active = true'), 'arm 位缺')
        const iArm = src.indexOf('options.hardSteer.active = true')
        const seg = src.slice(iArm, iArm + 1200)
        assert.ok(/finally\s*\{[\s\S]*?options\.hardSteer\.active = false/.test(seg), 'disarm 不在 finally 里')
    })
    test('shouldStop 三档顺序：aborted > shutdown > hard-steer（终态永远先判）', () => {
        const iShouldStop = src.indexOf('shouldStop: async () => {')
        assert.ok(iShouldStop >= 0, 'shouldStop 不再是显式函数（顺序锚依赖这个形状）')
        const seg = src.slice(iShouldStop, iShouldStop + 900)
        const iAbort = seg.indexOf("'aborted'")
        const iShutdown = seg.indexOf('shutdownStopRequested')
        const iHard = seg.indexOf('hardSteer')
        assert.ok(iAbort >= 0 && iAbort < iShutdown && iShutdown < iHard, `三档顺序漂移: aborted@${iAbort} shutdown@${iShutdown} hard@${iHard}`)
    })
    test('两处 pull 都清旗（打断现场 + 边界注入）——漏一处就是"下一轮首帧被自打断"的竞态', () => {
        const iInterrupt = src.indexOf("drained.stopped === 'hard-steer'")
        const interruptSeg = src.slice(iInterrupt, iInterrupt + 600)
        assert.ok(interruptSeg.includes('options.hardSteer.flag = null'), '打断现场没清旗 ⇒ 旗反复误伤')
        const iBoundary = src.indexOf('if (options.runMailbox) {')
        const boundarySeg = src.slice(iBoundary, iBoundary + 1400)
        assert.ok(boundarySeg.includes('options.hardSteer.flag = null'), '边界消费了 hard 却留旗 ⇒ 下个生成窗首帧凭空被打断')
    })
    test('ack 的决策从 llmLoop.steerAction 读，不在现场写死（v1.13 判据到此才算接线）', () => {
        assert.ok(src.includes("steerAction(s.mode, 'generating')"), 'ack 载荷应来自判据函数')
        const imp = /import \{[\s\S]*?steerAction,[\s\S]*?\} from '\.\/llmLoop\.js'/.test(src)
        assert.ok(imp, 'steerAction 必须从 llmLoop 单源导入（判据不许有第二份）')
    })
    test('半句作废三件套：并段、answerList 归集、emitReset（客户端不许把新答案拼在半句后）', () => {
        const iInterrupt = src.indexOf("drained.stopped === 'hard-steer'")
        const seg = src.slice(iInterrupt, iInterrupt + 3200)
        assert.ok(seg.includes('answerList.push(answerContent)') && seg.includes('answerContent = \'\''), '半句没归集清零 ⇒ 档案里新旧正文粘连')
        assert.ok(seg.includes('emitReset()'), 'emitReset 缺位 ⇒ 前端渲染拼接')
    })
})
