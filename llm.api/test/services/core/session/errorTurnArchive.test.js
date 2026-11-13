/**
 * @fileOverview 未捕获异常补写档案的用例（P8 处置 ②）
 * @module test/services/core/session/errorTurnArchive
 * @description
 * 这一段代码会**新增用户可见的档案行**，所以它每条"不写"的规矩都要能被测出来：
 * 覆盖真数据、造挂在空会话上的行、把"其实没写"报成"已补档"——这三种都是它可能造成的新缺陷，
 * 而不是原缺陷。判据全在纯函数里，写库用注入的假 dac，不碰任何真实数据库。
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {
    planErrorTurnArchive, errorTurnText, archiveUncaughtErrorTurn, ERROR_TURN_MARKER,
} from '../../../../services/core/session/errorTurnArchive.js'
import {PERSIST_VIA} from '../../../../services/core/session/shutdownPolicy.js'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')

/** 一个够用的默认入参，用例只覆盖自己关心的那一项，免得每个用例都在重抄八个字段 */
const base = {
    messageCode: 'm-1',
    conversationCode: 'c-1',
    conversationExists: true,
    hasArchive: false,
    query: '帮我把这段总结成三条',
    channel: 'xxzx_common',
    channelGroup: 'none',
    operator: {userCode: 'u-1', realName: '测试'},
    err: Object.assign(new Error('boom'), {name: 'TypeError'}),
    options: {},
}

describe('planErrorTurnArchive：三条"不写"的规矩', () => {
    test('缺 messageCode ⇒ skip（没有幂等键就别写）', () => {
        const r = planErrorTurnArchive({...base, messageCode: ''})
        assert.equal(r.action, 'skip')
        assert.equal(r.reason, 'no-message-code')
        assert.equal(r.fields, null)
    })
    test('缺 conversationCode ⇒ skip（档案挂不到任何会话上）', () => {
        assert.equal(planErrorTurnArchive({...base, conversationCode: ''}).reason, 'no-conversation-code')
    })
    test('已有档案 ⇒ skip，且这条优先于"会话不存在"', () => {
        const r = planErrorTurnArchive({...base, hasArchive: true, conversationExists: false})
        assert.equal(r.action, 'skip')
        assert.equal(r.reason, 'archive-exists', '真数据优先保护：顺序反了就会去动已有行')
    })
    test('会话没建起来 ⇒ skip（抛出在 add 之前，本来就没有残留，不许我造一行）', () => {
        const r = planErrorTurnArchive({...base, conversationExists: false})
        assert.equal(r.action, 'skip')
        assert.equal(r.reason, 'no-conversation')
    })
    test('该写的时候写成什么', () => {
        const {action, reason, fields} = planErrorTurnArchive(base)
        assert.equal(action, 'write')
        assert.equal(reason, 'uncaught-before-archive')
        assert.equal(fields.progress, 'error', 'progress 必须是 schema 里已有的 error（不是新造枚举）')
        assert.equal(fields.answer, '', '没有正文就落空串，不许写占位文案冒充正文')
        assert.equal(fields.query, base.query, '问题是这一轮唯一确定的事实，必须带上')
        assert.equal(fields.extInfo.writtenBy, PERSIST_VIA.ERROR)
        assert.equal(fields.extInfo.recoveredBy, ERROR_TURN_MARKER, '事后补的档要能当场认出来')
        assert.equal(fields.extInfo.lostChars, null, '"不知道丢了多少字"不等于"丢了 0 字"')
        assert.deepEqual(fields.operator, {userCode: 'u-1', realName: '测试'})
    })
    test('不写这些字段：llmModel / messages / segments / usage（没有就是没有，空值会伪装成"跑过"）', () => {
        const {fields} = planErrorTurnArchive(base)
        for (const k of ['llmModel', 'messages', 'segments', 'usage']) {
            assert.ok(!(k in fields), `补写行不该有 ${k}`)
        }
        for (const k of ['llmModel', 'messages', 'segments', 'usage']) {
            assert.ok(!(k in fields.extInfo), `extInfo 里也不该有 ${k}`)
        }
    })
    test('频道用调用方给的原始值 + 缺省（这里不自己造缺省字面量）', () => {
        assert.equal(planErrorTurnArchive({...base, channel: 'pdfviewer_literature'}).fields.channel, 'pdfviewer_literature')
        assert.equal(planErrorTurnArchive({...base, channel: '', channelGroup: ''}).fields.channelGroup, '')
    })
    test('缺 operator 时写空串而不是 undefined（下游按字符串读，不该拿到 undefined）', () => {
        const {fields} = planErrorTurnArchive({...base, operator: undefined})
        assert.deepEqual(fields.operator, {userCode: '', realName: ''})
    })
    test('缓存表态按同一套归一落档：cache:0 是"明确不允许"，缺键是"没有表态"', () => {
        const a = planErrorTurnArchive({...base, options: {cache: 0, channelCacheKey: 'res-1'}}).fields.extInfo
        assert.equal(a.cache, false)
        assert.equal(a.channelCacheKey, 'res-1')
        const b = planErrorTurnArchive({...base, options: {}}).fields.extInfo
        assert.equal(b.cache, null)
        assert.equal(b.channelCacheKey, null)
        const c = planErrorTurnArchive({...base, options: {cache: 2}}).fields.extInfo
        assert.equal(c.cache, null, '越界值不许被当成表态')
    })
})

describe('errorTurnText：归因要能在数据上认出来', () => {
    test('kind:name:message 三段形态', () => {
        const t = errorTurnText(Object.assign(new Error('db down'), {name: 'MongoError'}))
        assert.ok(t.startsWith('stream-uncaught:MongoError:'), t)
        assert.ok(t.endsWith('db down'), t)
    })
    test('没有 message 也给占位，不能给出悬空冒号', () => {
        assert.ok(errorTurnText({name: 'Error'}).endsWith('(无消息)'))
    })
    test('null / 字符串异常都不抛', () => {
        assert.ok(errorTurnText(null).startsWith('stream-uncaught:Error:'))
        assert.ok(errorTurnText('裸字符串').includes('裸字符串'))
    })
    test('抛出普通对象 ⇒ 不许写 [object Object]，要写占位（"没有消息"本身就是事实）', () => {
        const t = errorTurnText({code: 'X', detail: {}})
        assert.ok(!t.includes('object Object'), `归因里出现了噪声：${t}`)
        assert.ok(t.endsWith('(无消息)'), t)
    })
    test('抛出字符串 ⇒ 名字标成 ThrownString，消息原样带上', () => {
        assert.match(errorTurnText('库连接断了'), /^stream-uncaught:ThrownString:库连接断了$/)
    })
    test('换行压平 + 长度截断（档案不是堆栈仓库）', () => {
        const long = new Error('x'.repeat(500))
        const t = errorTurnText(long)
        assert.ok(!t.includes('\n'), '异常消息里的换行会把一行日志切成两条，归属就断了')
        assert.ok(t.length <= 'stream-uncaught:Error:'.length + 300 + 4, `未截断：${t.length}`)
    })
})

/** 假的 dac：只记录调用顺序与入参，不碰库 */
function fakeDacs({conversationInfo = {conversationCode: 'c-1'}, existing = null, finalizeResult = true, failOn = ''} = {}) {
    const calls = []
    const seen = {}
    return {
        calls,
        seen,
        dacs: {
            conversation: {
                async getByCode(code) {
                    calls.push('conversation.getByCode')
                    if (failOn === 'conversation') throw new Error('read failed')
                    return conversationInfo ? {code} : null
                },
            },
            message: {
                async getByCode(code, projection) {
                    calls.push('message.getByCode')
                    seen.projection = projection
                    return existing
                },
                async add(fields) {
                    calls.push('message.add')
                    seen.fields = fields
                    if (failOn === 'add') throw new Error('write failed')
                    return fields
                },
            },
            usage: {
                async finalizeIfProcessing(p) {
                    calls.push('usage.finalizeIfProcessing')
                    seen.finalize = p
                    return finalizeResult
                },
            },
        },
    }
}

describe('archiveUncaughtErrorTurn：顺序、失败方向与返回值诚实', () => {
    test('该写时：先读两个存在性 → 写档案 → 再收尾账本', async () => {
        const {calls, seen, dacs} = fakeDacs()
        const r = await archiveUncaughtErrorTurn({...base, dacs})
        assert.deepEqual(calls, ['conversation.getByCode', 'message.getByCode', 'message.add', 'usage.finalizeIfProcessing'])
        assert.equal(r.action, 'written')
        assert.equal(r.ledger, 'finalized')
        /** 这几条原来写在假 dac 里，会被 effect 的 try/catch 吞成 failed —— 挪到这里才会真的红 */
        assert.deepEqual(seen.projection, {_id: 1}, '存在性检查的投影要窄：拿到整个文档等于把正文读进内存')
        assert.equal(seen.finalize.progress, 'error', '账本收尾必须与档案同一个终态')
        assert.ok(!('interruptedBy' in (seen.finalize.patch || {})), 'interruptedBy 不是账本列，别往这里塞')
    })
    test('已有档案：一次都不写，也不收尾账本', async () => {
        const {calls, dacs} = fakeDacs({existing: {_id: 'x'}})
        const r = await archiveUncaughtErrorTurn({...base, dacs})
        assert.equal(r.action, 'skip')
        assert.equal(r.reason, 'archive-exists')
        assert.ok(!calls.includes('message.add'), '有档案还写就是覆盖真数据')
        assert.ok(!calls.includes('usage.finalizeIfProcessing'), '档案都不写，凭什么改账本状态')
    })
    test('会话不存在：不写', async () => {
        const {calls, dacs} = fakeDacs({conversationInfo: null})
        const r = await archiveUncaughtErrorTurn({...base, dacs})
        assert.equal(r.reason, 'no-conversation')
        assert.ok(!calls.includes('message.add'))
    })
    test('账本已不是中途（比如 run 自己已收尾）⇒ 档案照写，ledger 报 not-processing，不重试不改状态', async () => {
        const {dacs} = fakeDacs({finalizeResult: false})
        const r = await archiveUncaughtErrorTurn({...base, dacs})
        assert.equal(r.action, 'written')
        assert.equal(r.ledger, 'not-processing')
    })
    test('写档案失败 ⇒ 返回 failed 且**不抛回调用方**（它跑在错误处理路径上）', async () => {
        const {dacs} = fakeDacs({failOn: 'add'})
        const r = await archiveUncaughtErrorTurn({...base, dacs})
        assert.equal(r.action, 'skip')
        assert.match(r.reason, /^failed:Error:write failed/)
        assert.equal(r.ledger, 'error')
    })
    test('存在性读失败也收敛成 failed，不抛', async () => {
        const {dacs} = fakeDacs({failOn: 'conversation'})
        const r = await archiveUncaughtErrorTurn({...base, dacs})
        assert.equal(r.action, 'skip')
        assert.match(r.reason, /^failed:/)
    })
    test('写档前不碰 llmUsage（顺序反了会留下"账本已终态、档案没有"，那正是回填的认领条件）', async () => {
        const {calls, dacs} = fakeDacs()
        await archiveUncaughtErrorTurn({...base, dacs})
        assert.ok(calls.indexOf('message.add') < calls.indexOf('usage.finalizeIfProcessing'),
            '先收尾账本再写档案 ⇒ 中间崩一次，这轮就被回填按 process-lost 误归因')
    })
})

describe('跨文件的一致性承诺', () => {
    /**
     * 补写行的 channel 来自 `options.channel || defaultChannel`，
     * 而这个缺省值定义在 llmChat 里。**两侧同值**这件事不能只靠注释，
     * 否则"哪天改缺省"就是又一次只改一半。
     */
    test('llmChat 必须仍然 export 缺省频道，且用它拼 channel', () => {
        const lines = fs.readFileSync(path.join(SRC, 'services/core/llmChat.js'), 'utf8').replace(/\r/g, '').split('\n')
        assert.ok(lines.some((l) => /^export const defaultChannel = /.test(l)), 'defaultChannel 不再被导出 ⇒ 路由拿不到同一个缺省')
        assert.ok(lines.some((l) => /^\s*const channel = options\.channel \|\| defaultChannel$/.test(l)),
            'llmChat 里那句 channel 的写法变了 ⇒ 补写行与真实行的 channel 口径要重新对齐')
        const route = fs.readFileSync(path.join(SRC, 'routes/core/chat/root.js'), 'utf8').replace(/\r/g, '')
        assert.ok(/import \{execChat, defaultChannel, defaultChannelGroup\}/.test(route), '路由没再 import 这两个缺省')
    })
    test('路由的 catch 必须真的叫到补写函数（删掉它 = 回到"有会话无档案"）', () => {
        const lines = fs.readFileSync(path.join(SRC, 'routes/core/chat/root.js'), 'utf8').replace(/\r/g, '').split('\n')
        const emit = lines.findIndex((l) => /channel\.emit\([^)]*'error'\)/.test(l))
        assert.ok(emit >= 0, '找不到 emit error 帧')
        const after = lines.slice(emit, emit + 26).join('\n')
        assert.match(after, /archiveUncaughtErrorTurn\(/, 'catch 里没有补写调用 ⇒ 用户看到 error 帧而档案仍什么都没有')
        assert.match(after, /reason:/, '补写结果没被记进日志 ⇒ "其实没写"会被读成"已补档"')
    })
    /**
     * 账本收尾那条条件更新的判据，必须在 dac 里真的走 `finalizeFilter`。
     * 谁把它"顺手改成"内联 `{messageCode}`，功能一点问题都看不出来，
     * 但晚到的收尾就能把 run 自己写的 finish 覆盖成 error——那是把成功轮次改成失败，比缺行更坏。
     */
    test('llmUsageDac.finalizeIfProcessing 必须用 finalizeFilter 生成条件', () => {
        const lines = fs.readFileSync(path.join(SRC, 'daos/core/dac/llmUsageDac.js'), 'utf8').replace(/\r/g, '').split('\n')
        const at = lines.findIndex((l) => /async finalizeIfProcessing\(/.test(l))
        assert.ok(at >= 0, '找不到 finalizeIfProcessing ⇒ 补写链路的账本收尾被移除了')
        const body = lines.slice(at, at + 16).join('\n')
        assert.match(body, /finalizeFilter\(\{messageCode\}\)/, '条件不在这里拼：内联过滤器就是绕开判据')
        assert.match(body, /updateOne\(/, '必须用 updateOne（updateMany 会一次改掉不该动的行）')
    })
})
