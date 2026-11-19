/**
 * @fileOverview PR-M 接线守卫（Wiring-A：外置 + recitation + 落档）
 * @module test/services/core/planWiring
 * @description
 * `planState`/`planTool`/`planAssembly` 三个纯模块单测全绿，只证明"判据对"，不证明"主循环真的调用了它们"。
 * 本档为此已经写过三次"两侧齐"守卫（extInfoPassthrough、skillGovernanceWiring、egressPosture §4）——
 * 纯函数存在但没人调，等于没有。所以这里从 `llmChat.js` / `llmLoop.js` 源码断言四处接线都在、且位置对。
 *
 * 刻意用源码级断言而不是起 app 打流量：PR-M 默认关（`plan_enabled`），要跑到 update_plan 得让真模型主动调工具，
 * 那既不可靠、又要花 relay 的流量。**默认关这件事本身**由"关时工具不下发、withRecitation 原样返回"两纯函数保证
 * （planTool.test / planAssembly.test 已各自测过），接线守卫只需证明"开的时候会被走到"。
 *
 * 锚点全部限定在具体语句形态、先剥注释，避免"函数名在注释里出现过"这种空转断言（本档记过多次的坑）。
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

function findSrc(startDir) {
    let dir = startDir
    for (let i = 0; i < 10; i++) {
        if (fs.existsSync(path.join(dir, 'services/core/llmChat.js'))) {
            return dir
        }
        const up = path.dirname(dir)
        if (up === dir) break
        dir = up
    }
    throw new Error('找不到 src 根')
}
const SRC = findSrc(path.dirname(fileURLToPath(import.meta.url)))
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const codeOf = (rel) => strip(fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r/g, ''))
const chat = () => codeOf('services/core/llmChat.js')

describe('1 工具下发：开才推、且用 planToolEnabled 判', () => {
    test('allTools 里推 buildPlanTools 且受 planToolEnabled 门控', () => {
        const c = chat()
        assert.match(c, /const planOn = planToolEnabled\(planCfg\)/, 'planOn 必须由 planToolEnabled 算出')
        assert.match(c, /if \(planOn\) \{\s*\n\s*allTools\.push\(\.\.\.buildPlanTools\(\)\)/, '工具下发必须在 planOn 分支内（否则默认关也下发）')
    })
})

describe('2 分派：update_plan 走 executePlanTool，结果并入 toolResults', () => {
    test('classifyToolCalls 传了 isPlanTool 并解出 planCalls', () => {
        const c = chat()
        assert.match(c, /classifyToolCalls\([\w]+, \{isMemoryTool, isOverflowTool, isCodeTool, isPlanTool, isArtifactTool: /,
            '分派没把 isPlanTool/isArtifactTool 传进去 ⇒ update_plan/save_artifact 会被丢给 mcpToolManager（artifact 谓词的形状归 intakeWiring 守卫盯；首参变量名归 llmChatGateWiring 盯——门 choke 点改名是合法的，故这里泛化，不锁死 toolCalls/gatePassedCalls 的字面）')
        assert.match(c, /const \{memoryCalls, overflowCalls, codeCalls, planCalls, artifactCalls, askCalls, attachmentCalls, otherCalls\} =/, '没解构出 planCalls/artifactCalls（attachmentCalls 是 B-1 随迁位，缺它=附件调用石沉大海）')
    })
    test('planCalls 经 executePlanTool 执行、并回写 currentPlan、结果进 toolResults', () => {
        const c = chat()
        assert.match(c, /const planResults = planCalls\.map\(toolCall => \{[\s\S]*?executePlanTool\(\{toolCall, planConfig: planCfg\}\)[\s\S]*?currentPlan = \{items: parsed\.data\.items\}/,
            'planCalls 必须执行并把归一后的 items 记进 currentPlan')
        assert.match(c, /const toolResults = \[\.\.\.(?:gateBlockedResults, \.\.\.)?memoryResults, \.\.\.overflowResults, \.\.\.codeResults, \.\.\.planResults, \.\.\.artifactResults, \.\.\.askResults, (?:\.\.\.attachmentResults, )?\.\.\.otherResults\]/,
            'planResults/artifactResults 不并入 toolResults ⇒ 模型收不到计划/产物工具的回执，且回执不进历史（首位 gateBlockedResults 可选——门的回执同样要合流；attachmentResults 为 B-1 位，可选保旧锚）')
    })
})

describe('3 recitation：只拼发送副本、不改 createBody 与 messages', () => {
    test('发送 body 用 sendMessages，且只在真的注入了时才浅拷贝替换 messages', () => {
        const c = chat()
        assert.match(c, /const sendMessages = planOn\s*\n\s*\? withRecitation\(messages, currentPlan, \{enabled: planOn, maxChars: planCfg\.recitationMaxChars\}\)\s*\n\s*: messages/,
            'recitation 必须经 withRecitation，且关着时直接用 messages（不产生副本、不注入）')
        assert.match(c, /body: sendMessages === messages \? createBody : \{\.\.\.createBody, messages: sendMessages\}/,
            '必须"没注入就复用 createBody、注入了才 {...createBody, messages: sendMessages}"——直接改 createBody.messages 会污染历史')
    })
    test('绝不出现 messages.push(recitation) 这种把注入写进历史的写法', () => {
        const c = chat()
        assert.ok(!/messages\.push\(\s*\{[^}]*recitat/i.test(c), '发现把 recitation push 进 messages 的写法')
    })
})

describe('4 落档：plan 从 persistTurn 传到 saveMessage 唯一出口', () => {
    test('persistTurn 传 plan: planForPersistence(currentPlan)，装配清单写 plan: options.plan', () => {
        const c = chat()
        assert.match(c, /plan: planForPersistence\(currentPlan\)/, '没把 currentPlan 归一后传给 saveMessage ⇒ extInfo.plan 永远缺')
        assert.match(c, /extInfo: \{[\s\S]*?plan: options\.plan,[\s\S]*?\n        \}/, '装配清单没有 plan: options.plan ⇒ 上游写了也不落库（正是 runOverlap 漏接那次的形状）')
    })
})

describe('5 默认关：主循环里所有 plan 调用都在 planOn 之后或有 executePlanTool 自检', () => {
    test('withRecitation 调用点受 planOn 三元保护（关着不会构造注入）', () => {
        const c = chat()
        // sendMessages 的定义里 planOn 为假时走 : messages 分支——已在 §3 断言，这里再钉一次"不存在无条件调用"
        const unconditional = /withRecitation\(messages, currentPlan, \{enabled: true/.test(c)
        assert.equal(unconditional, false, '不该出现写死 enabled:true 的 recitation 调用')
    })
})

describe('7 B2 完成性反问：门控、缓冲、不污染 finalize 语义', () => {
    test('触发点受 config.finalize?.selfCheck 门控（关着整段不执行）', () => {
        const c = chat()
        assert.match(c, /if \(config\.finalize\?\.selfCheck === true\) \{[\s\S]*?decideCompletionSelfCheck\(\{[\s\S]*?runSelfCheckCall\(\)/,
            'self-check 必须包在 finalize.selfCheck===true 内；写在外面就是默认给每轮加一次上游调用')
    })
    test('反问调用点不置 forcedFinal / finalizeInterrupted（那是"空答案被迫补"的语义）', () => {
        const c = chat()
        const sc = /const runSelfCheckCall = async \(\) => \{[\s\S]*?\n    \}\n/.exec(c)
        assert.ok(sc, '找不到 runSelfCheckCall 定义')
        assert.ok(!/forcedFinal\s*=/.test(sc[0]), 'runSelfCheckCall 不该写 forcedFinal')
        assert.ok(!/finalizeInterrupted\s*=/.test(sc[0]), 'runSelfCheckCall 不该写 finalizeInterrupted（它会改本轮落库分派）')
    })
    test('反问响应先缓冲、判定 append 才吐给客户端（绝不把可能被丢弃的内容先流出去）', () => {
        const c = chat()
        const sc = /const runSelfCheckCall = async \(\) => \{[\s\S]*?\n    \}\n/.exec(c)[0]
        assert.match(sc, /onDelta: \(\) => \{\}/, 'callUpstream 的 onDelta 必须是空实现（不外发）')
        // 吐给客户端的 streamCallback 必须出现在"决定 append"之后，且送的是 supplement 而非整段 drained.content
        const appendAt = sc.indexOf("verdict.action === 'append'")
        const streamAt = sc.indexOf('options.streamCallback')
        assert.ok(appendAt >= 0 && streamAt > appendAt, 'streamCallback 只能在判定 append 之后出现')
        assert.match(sc, /streamCallback\(JSON\.stringify\(\{role: 'assistant', content: verdict\.supplement/, '外发的必须是补充内容本身')
    })
    test('并入口径：只有 CONTINUE+有补充才并入，DONE/空/非标记都保留原答案', () => {
        const c = chat()
        const sc = /const runSelfCheckCall = async \(\) => \{[\s\S]*?\n    \}\n/.exec(c)[0]
        assert.match(sc, /const verdict = interpretSelfCheckReply\(drained\.content\)/, '必须走已测的 interpretSelfCheckReply，不在主循环里手搓解析')
        assert.match(sc, /if \(verdict\.action === 'append' && verdict\.supplement\) \{/, '并入条件必须同时要求 append 且有补充')
        assert.match(sc, /answerContent \+= \(answerContent \? '\\n\\n' : ''\) \+ verdict\.supplement/, '补充要并进 answerContent（与 finalize 的 append 同族，但前面留分隔）')
    })
    test('补充要封一条 self-check 段（决策 ii），且失败/打断都保留原答案', () => {
        const c = chat()
        const sc = /const runSelfCheckCall = async \(\) => \{[\s\S]*?\n    \}\n/.exec(c)[0]
        assert.match(sc, /segments\.seal\(\{[\s\S]*?kind: SEGMENT_KINDS\.SELF_CHECK/, '并入了就要封 SELF_CHECK 段（否则 answerContent 与分段账对不上）')
        assert.match(sc, /if \(drained\.stopped\) \{[\s\S]*?return false/, '反问被打断 ⇒ 丢弃、保留原答案')
        assert.match(sc, /\} catch \(e\) \{[\s\S]*?return false/, '反问失败 ⇒ 保留原答案，绝不拖垮整轮')
    })
})

describe('6 B1 跨轮 seed：只在 planOn 时读一次，且失败不致命', () => {
    test('seed 读被 `if (planOn)` 包住（关着连这次 DB 查询都不发 ⇒ 默认关对现网零成本）', () => {
        const c = chat()
        assert.match(c, /if \(planOn\) \{[\s\S]*?currentPlan = seedPlanFromPrior\(await messageDac\.getLatestExtInfoPlan\(conversationCode\)\)/,
            '跨轮 seed 的 DB 读必须在 planOn 分支内；写在外面就是给每次聊天多加一次查询')
    })
    test('seed 走 seedPlanFromPrior（复用已测纯函数，不在主循环里手搓解析）', () => {
        assert.match(chat(), /currentPlan = seedPlanFromPrior\(await messageDac\.getLatestExtInfoPlan\(conversationCode\)\)/,
            '回读应直接喂给 seedPlanFromPrior，保证与落档端同一套归一')
    })
    test('seed 有 try/catch（拿不到上一轮计划不能阻断本轮）', () => {
        const c = chat()
        assert.match(c, /if \(planOn\) \{\s*\n\s*try \{[\s\S]*?seedPlanFromPrior[\s\S]*?\} catch/, 'seed 必须容错')
    })
    test('dac 方法只投影 extInfo.plan（不为读计划把整坨 extInfo 拉进内存）', () => {
        const dac = codeOf('daos/core/dac/messageDac.js')
        const m = /async getLatestExtInfoPlan\(conversationCode\)[\s\S]*?getOneByFilter\((\{(?:[^{}]|\{[^{}]*\})*\}),\s*(\{[^}]*\})/.exec(dac)
        assert.ok(m, '找不到 getLatestExtInfoPlan 或其过滤/投影参数')
        assert.match(m[2], /extInfo\.plan/, '投影必须只取 extInfo.plan')
        /** 批二b：本轮自己的 processing 中途行在 seed 之前就存在（markStarted 在前），
         * 不过滤终态就会把"本轮空档"当"上一轮计划"——recitation 静默清零 */
        assert.match(m[1], /progress:\s*\{\$in:\s*TERMINAL_PROGRESS\}/,
            'seed 读必须限定终态行（TERMINAL_PROGRESS 单源），否则批二b 的中途行会冒充上一轮')
    })
})
