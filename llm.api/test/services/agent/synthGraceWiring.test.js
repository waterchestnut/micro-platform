/**
 * @fileOverview 综合宽限窗（§7-2）的接线与形状守卫
 * @module test/services/agent/synthGraceWiring.test
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const readCode = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8').split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

describe('fanOutFinalizeTask：宽限分支的位置与纪律', () => {
    const code = readCode('services/agent/handler/fanOutFinalizeTask.js')

    test('gate=Number>0（0/缺省 ⇒ 整块不执行，"树完成即综合"逐字现状的地基）', () => {
        assert.match(code, /const graceMs = Number\(orchCfg\.synthGraceMs\) \|\| 0/)
        assert.match(code, /if \(graceMs > 0 && finFinal\.dispatch\?\.needSynthesis === true && finFinal\.cancelled !== true\)/)
        // 截胡块必须在 synthesis 主段之前（判位置）
        const graceAt = code.indexOf("const graceMs = Number(orchCfg.synthGraceMs)")
        const synthAt = code.indexOf('if (finFinal.dispatch.needSynthesis && finFinal.synthesisInput')
        assert.ok(graceAt > 0 && synthAt > graceAt, '宽限截胡必须在综合主段之前')
    })
    test('排行为幂等：已有未终 synth-timer 行不再排（一 root 一张闹钟），且**排除正在跑的自己**（顺延黑洞的诊断实锤）', () => {
        assert.match(code, /const pend = await agentTaskDac\.getTop\(2, \{complexFilter: \{agentRole: SYNTH_TIMER_ROLE, handleStatus: 0, 'params\.rootCode': rootCode\}\}\)/)
        assert.match(code, /const others = \(pend \|\| \[\]\)\.filter\(\(r\) => r\.agentCode !== agentTaskInfo\.agentCode\)/)
        assert.match(code, /if \(!others\.length\) \{[\s\S]{0,800}await addAgentTask\(timer\)/)
    })
    test('timer 重算挂回同一条行（dueAt 刷、round 进、status 回 0）——execAgentTask 收尾会覆写行状态，'
        + '不就地重挂就得等泵捞"排新行"的窗口，双闹钟/漏闹钟都在这条缝里（探针 G5 两轮实锤）', () => {
        assert.match(code, /await agentTaskDac\.update\(\{\s*handleStatus: 0, 'params\.dueAt': timing\.dueAt,\s*'params\.synthRound': Number\(p\.synthRound\) \+ 1, updateTime: new Date\(\),\s*\}, \{agentCode: agentTaskInfo\.agentCode\}\)/)
        assert.match(code, /if \(Number\(p\.synthRound\) > 0 && agentTaskInfo\.agentRole === SYNTH_TIMER_ROLE\) \{/)
    })
    test('treeDoneAt 锚随行不随"上次看表"（无限顺延的病根，判据注释同源）', () => {
        assert.match(code, /const treeDoneAt = Number\(p\.treeDoneAt\) \|\| Date\.now\(\)/)
        assert.match(code, /treeDoneAt,/m)
    })
    test('活性查询限 root 原会话+树完成后+非空 query（读失败按无动作——敢综合不是永挂）', () => {
        assert.match(code, /conversationCode: root\.conversationCode,/)
        assert.match(code, /query: \{\$nin: \['', null\]\}/)
        assert.match(code, /insertTime: \{\$gt: new Date\(treeDoneAt\)\}/)
        assert.match(code, /catch \(e\) \{[\s\S]{0,200}活性读数失败/)
    })
    test('schedule 档 return 前不碰 orchestration（detail 维持 synthesizing 是真话，不新造相位）', () => {
        const seg = code.slice(code.indexOf("if (timing.act === 'schedule')"), code.indexOf("if (timing.reason === 'postpone-exhausted')"))
        assert.ok(seg.length > 200 && !seg.includes("'handleRet.orchestration."), 'schedule 档写了 orchestration=相位造假')
        assert.ok(seg.includes('return {handleStatus: 2') || seg.includes('return {handleStatus: 0'), 'finalize task 自身要善终（首算 2/重挂 0）')
    })
    test('exhausted 走写回 note（synthNote 并进主写回）', () => {
        assert.match(code, /finFinal\.synthNote = timing\.reason/)
        assert.match(code, /synthNote: finFinal\.synthNote/)
    })
})

describe('泵与注册：闹钟没上就不注册', () => {
    test('retention 注册条件=graceMs>0 ∧ pumpEnabled≠false，懒 import 泵', () => {
        const code = readCode('cron/retention.js')
        assert.match(code, /llm\.config\.agentTask\?\.fanOutOrchestration\?\.synthGraceMs > 0 && cronConfig\.pumpEnabled !== false/)
        assert.match(code, /await import\('\.\.\/tasks\/synthTimerPump\.js'\)/, '泵模块必须懒 import（默认关零加载）')
        assert.match(code, /lock:synthTimerPump|runGuarded\('synthTimerPump'/)
    })
    test('泵扫描面：agentRole synth-timer + waiting + dueAt 升序（最先到点的先排）', () => {
        const code = readCode('tasks/synthTimerPump.js')
        assert.match(code, /complexFilter: \{ agentRole: SYNTH_TIMER_ROLE, handleStatus: 0 \}/)
        assert.match(code, /\{ 'params\.dueAt': 1, insertTime: 1 \}/)
        assert.match(code, /acquireOnce\('lock:synthTimerPump'/)
    })
    test('候选走严格认领语义（role recover 档，held 不派——executor 档的 proceed-on-held 用在这就是双综合）', () => {
        const code = readCode('services/agent/synthTimerCandidate.js')
        assert.match(code, /claimDecision\(\{role: 'recover', state: claim\.state\}\)/)
    })
})

describe('config：synthGraceMs 默认 0（=现状），maxPostpone 默认 3', () => {
    test('默认值', async () => {
        const {default: cfg} = await import('../../../conf/system.config.js')
        const o = cfg.agentTask?.fanOutOrchestration
        assert.equal(o.synthGraceMs, 0, '默认 0=即时综合——本刀的地基：不开关与现网逐字一致')
        assert.equal(o.synthMaxPostpone, 3)
    })
    test('env 数字直读；坏值归 0（NaN 不许变成"永远 schedule"）', async () => {
        process.env.agentTask_fanOutOrchestrationSynthGraceMs = '45000'
        process.env.agentTask_fanOutOrchestrationSynthMaxPostpone = '5'
        let mod = await import(`../../../conf/system.config.js?v=${Math.random()}`)
        assert.equal(mod.default.agentTask.fanOutOrchestration.synthGraceMs, 45000)
        assert.equal(mod.default.agentTask.fanOutOrchestration.synthMaxPostpone, 5)
        process.env.agentTask_fanOutOrchestrationSynthGraceMs = 'soon'
        mod = await import(`../../../conf/system.config.js?v=${Math.random()}`)
        delete process.env.agentTask_fanOutOrchestrationSynthGraceMs
        delete process.env.agentTask_fanOutOrchestrationSynthMaxPostpone
        assert.equal(mod.default.agentTask.fanOutOrchestration.synthGraceMs, 0, '坏值必须归 0 不是 NaN')
    })
})
