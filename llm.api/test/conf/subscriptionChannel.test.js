/**
 * @fileOverview 频道表专项：callin_subscription 订阅专属频道（R8）的"全关"形态钉死
 * @module test/conf/subscriptionChannel
 * @description
 * 该频道存在的意义=干净：无 MCP、无 skills、无记忆、sysPrompt 最小中性。
 * 每条都是"为什么关着"的账（11-19 用户拍板不共享 xxzx_common），用例防止后人顺手打开。
 */
import {test} from 'node:test'
import * as assert from 'node:assert'
import llmChannelDataSet, {validateChannels, getChannelMemory} from '../../conf/llmChannel.js'

const ch = () => llmChannelDataSet.callin_subscription

test('callin_subscription 频道在配置表内（validateChannels 认得）', () => {
    assert.deepEqual(validateChannels(['callin_subscription']), [], '新频道必须通过校验，否则 completion 400')
})

test('全关形态：MCP/skills/memory 皆关，工具面干净', () => {
    const c = ch()
    assert.equal(c.enableMcp, false, 'MCP 必须关（toolManager 消费 enableMcp，纯 prompt 任务不许长出 web 搜索）')
    assert.equal(c.mcpServers, undefined, '不配 mcpServers（enableMcp 与 mcpServers 双缺才彻底）')
    assert.equal(c.skills.enabled, false, 'skills 关')
    assert.deepEqual(c.skills.skillNames, [], 'skillNames 空')
    assert.equal(c.skills.enableSkillExecution, false, 'skill 自动执行关')
    const mem = getChannelMemory('callin_subscription')
    assert.equal(mem.enabled, false, '记忆总关（与调用侧 options.memory off 双保险）')
    assert.equal(mem.capture, false)
    assert.equal(mem.recall, false)
})

test('sysPrompt 最小中性：只做输出纪律，不含任务语义（业务 prompt 随 query 由 callin 携带）', () => {
    const sys = ch().sysPrompt
    assert.ok(sys.length > 0 && sys.length < 200, `sysPrompt 应短小中性，实际 ${sys.length} 字符`)
    assert.ok(!/关键词|检索式|导读|论文/.test(sys), '频道 sysPrompt 不得混入订阅业务语义（模板住业务方 D9）')
})
