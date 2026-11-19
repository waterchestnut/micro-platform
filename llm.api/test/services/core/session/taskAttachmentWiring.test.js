/**
 * @fileOverview 附件授权前门（B-1）的接线与形状守卫
 * @module test/services/core/session/taskAttachmentWiring.test
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const readCode = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8').split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

describe('llmChat：read_attachment 的注册/分派/执行三点位', () => {
    const code = readCode('services/core/llmChat.js')

    test('注册是双闸：enabled 显式 true **且** run 带 taskContext.rootCode（普通轮根本看不见这工具）', () => {
        assert.match(code, /attachCfg\.enabled === true && !!options\.taskContext\?\.rootCode/)
        assert.match(code, /if \(attachOn\) \{\s*allTools\.push\(\.\.\.buildReadAttachmentTools\(\)\)/)
    })
    test('分类谓词条件注入（关着=与现网逐字一致）；attachmentCalls 有解构位', () => {
        assert.match(code, /\.\.\.\(attachOn \? \{isAttachmentTool: isReadAttachmentTool\} : \{\}\)/,
            'isAttachmentTool 不是条件 spread 或没有映射到实指（e2e 曾抓到裸 shorthand=未定义标识符当场 ReferenceError）')
        assert.match(code, /const \{memoryCalls,[\s\S]{0,80}attachmentCalls, otherCalls\} =/, 'attachmentCalls 没有从 classify 解构出来')
    })
    test('执行段懒 import：attachmentCalls 为空连 docApiExtract/agentTaskDac 都不加载', () => {
        assert.match(code, /if \(attachmentCalls\.length\) \{[\s\S]{0,400}import\('\.\/attachment\/docApiExtract\.js'\)/)
        assert.match(code, /import\('\.\.\/\.\.\/daos\/core\/dac\/agentTaskDac\.js'\)/)
    })
    test('执行段把 taskContext 与 root 快照读取交给纯件（判定零内联——比较运算不许出现在这里）', () => {
        const seg = code.slice(code.indexOf('attachmentResults = await Promise.all'), code.indexOf('attachmentResults = await Promise.all') + 900)
        assert.ok(seg.includes('executeReadAttachmentTool'), '执行没走 executeReadAttachmentTool')
        assert.ok(seg.includes('getRootParams'), 'deps.getRootParams 接线丢失')
        assert.ok(!/=== *'f/.test(seg) && !/includes\('f/.test(seg), '执行段手写了 fileCode 比较=第二套真相')
    })
    test('toolResults 拼接串里有 attachmentResults（漏了=结果石沉大海）', () => {
        assert.match(code, /\.\.\.askResults, \.\.\.attachmentResults, \.\.\.otherResults/)
    })
})

describe('agentChat：清单注入面（前门开、后门仍封）', () => {
    const code = readCode('services/agent/handler/agentChat.js')

    test('enabled 显式 true 才注入；rootCode 口径与 taskContext 同式（parentCode 优先）', () => {
        assert.match(code, /attachCfg\.enabled === true/)
        assert.match(code, /agentTaskInfo\.parentCode \|\| agentTaskInfo\.agentCode/)
    })
    test('注入产物进 execChat 调用位（拼了不用=没接线）', () => {
        assert.match(code, /execChat\(curUserInfo, childQuery, childConversationCode/)
    })
    test('B-2 红线保持：不透传 attachments 给 buildChildExecOptions（前门不等于后门重开）', () => {
        assert.ok(!/attachments:\s*p\.attachments/.test(code), 'agentChat 又透传附件了——B-2 封的后门被本次改动重开')
    })
})

describe('config：taskAttachment 默认关、env 严格开、maxChars 有默认', () => {
    test('默认关 + maxChars=12000', async () => {
        const {default: cfg} = await import('../../../../conf/system.config.js')
        const t = cfg.limits?.taskAttachment
        assert.ok(t, '配置缺 limits.taskAttachment')
        assert.equal(t.enabled, false, '默认必须关')
        assert.equal(t.maxChars, 12000)
    })
    test("env 严格 'true' 才开", async () => {
        process.env.limits_taskAttachment = 'true'
        const mod = await import(`../../../../conf/system.config.js?v=${Math.random()}`)
        assert.equal(mod.default.limits.taskAttachment.enabled, true)
        process.env.limits_taskAttachment = '1'
        const mod2 = await import(`../../../../conf/system.config.js?v=${Math.random()}`)
        assert.equal(mod2.default.limits.taskAttachment.enabled, false, '"1" 不许开（严格 ===true）')
        delete process.env.limits_taskAttachment
    })
})
