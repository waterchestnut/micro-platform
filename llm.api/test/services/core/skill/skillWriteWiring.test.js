/**
 * @fileOverview skill 写面幂等闸的接线与形状守卫（源码位）
 * @module test/services/core/skill/skillWriteWiring.test
 * @description
 * 行为在 `skillWriteGate.test.js`（真跑）与 e2e（真库真账）里证；这里守的是"接线还长在原位"：
 * 关闸逐字旧调用、懒 import、键的 run 段单源、claim 的 create-once 语义（new:false）、
 * settle 的 CAS、解锁事实的注入点。**每一条红的含义都是"结构被改坏"，不是"代码没风格"**。
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8').split('\n')
const codeOnly = (lines) => lines.filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))

describe('llmChat：other 工具段的写面闸接线', () => {
    const lines = codeOnly(read('services/core/llmChat.js'))
    const code = lines.join('\n')

    test('显式 true 才走闸（缺省/其它值都落 else=现网逐字）', () => {
        assert.match(code, /writeGateCfg\.enabled === true/, '闸开关比较漂移（"1" 也能开=热路径失守）')
        const elseIdx = lines.findIndex((l) => l.includes('writeGateCfg.enabled === true'))
        assert.ok(elseIdx >= 0)
        const seg = lines.slice(elseIdx, elseIdx + 30).join('\n')
        assert.match(seg, /await import\('\.\/skill\/skillWriteGate\.js'\)/, '闸模块不是动态 import（默认关必须零加载）')
    })
    test('关闸分支保留旧批量调用逐字（skillChat/mcp 二选一原样）', () => {
        assert.match(code, /otherResults = skillContext\n?\s*\? await skillChat\.executeSkillToolCalls\(otherCalls, skillContext\)/s,
            'else 分支的旧批量调用被改动（默认关=逐字节现网不变的地基）')
        assert.match(code, /:\s*await mcpToolManager\.executeToolCalls\(channel, otherCalls\)/, '旧 mcp 批量调用丢失')
    })
    test('键的 run 段=messageCode 单源（与 artifact :1902 同口径，注释与代码同链）', () => {
        assert.match(code, /runCode: messageCode,/, '闸的 runCode 不是 messageCode（换变量=键空间漂移）')
        const seg = lines.slice(lines.findIndex((l) => l.includes('runToolCallsWithWriteGate')),
            lines.findIndex((l) => l.includes('runToolCallsWithWriteGate')) + 16).join('\n')
        assert.match(seg, /execOne: \(toolCall\) => skillContext/, 'execOne 没有沿用 skillContext 二选一的旧路由')
        assert.match(seg, /skillChat\.executeSkillToolCalls\(\[toolCall\], skillContext\)/, 'execOne 没走逐条 skillChat 旧面')
        assert.match(seg, /mcpToolManager\.executeToolCalls\(channel, \[toolCall\]\)/, 'execOne 没走逐条 mcp 旧面')
    })
    test('cfg 与 context 从 config/curUserInfo 单源取（不许就地造第二套开关形状）', () => {
        assert.match(code, /config\.limits\?\.skillWriteIdempotency \|\| \{\}/, 'cfg 读取形状漂移')
        assert.match(code, /context: \{conversationCode, userCode: curUserInfo\?\.userCode \|\| ''\}/, 'context 注入漂移')
    })
})

describe('dac：claim 的 create-once 语义钉子', () => {
    const code = codeOnly(read('daos/core/dac/skillWriteJournalDac.js')).join('\n')

    test('claim 用 upsert + new:false（插入返回 null=区分"我认领"与"行已存在"的唯一办法）', () => {
        assert.match(code, /\{upsert: true, new: false\}/, 'new 语义漂移会让并发双跑换姿势复活')
        assert.match(code, /\$setOnInsert[\s\S]{0,600}status: 'started'/, 'claim 显式写 started（artifact born-registered 教训）')
    })
    test('settle 带 status:started CAS（迟到覆写不许发生）', () => {
        assert.match(code, /\{idempotencyKey: key, status: 'started'\}/, 'settle 不是 CAS=可能覆写 done 行')
    })
})

describe('B-4 解锁注入面：bound 从 config 事实计算，默认不解锁', () => {
    test('agentTaskRecover 每候选注入 skillWriteIdempotencyBound(llm.config)', () => {
        const code = codeOnly(read('tasks/agentTaskRecover.js')).join('\n')
        assert.match(code, /skillWriteBound: skillWriteIdempotencyBound\(llm\.config\)/, 'bound 注入丢失=解锁面断裂（保持 defer 默认）')
    })
    test('recoverCandidate 把 bound 透传给 recoverDirectAllowed', () => {
        const code = codeOnly(read('services/agent/recoverCandidate.js')).join('\n')
        assert.match(code, /recoverDirectAllowed\(\{task, parent, parentReadFailed, skillWriteBound\}\)/, 'gate 调用没带 bound')
        assert.match(code, /skillWriteBound = false/, '参数缺省必须 false（解锁要显式事实）')
    })
})

describe('config：skillWriteIdempotency 默认关、env 严格开、名单从逗号串来', () => {
    test('默认 enabled=false / 名单空 / 快照 8192', async () => {
        const {default: cfg} = await import('../../../../conf/system.config.js')
        const w = cfg.limits?.skillWriteIdempotency
        assert.ok(w, '配置缺 limits.skillWriteIdempotency')
        assert.equal(w.enabled, false, '默认必须关（关时 llmChat 逐字现网不变是本刀地基）')
        assert.deepEqual(w.writeTools, [], '默认名单空=闸即便被开也不约束任何工具（解锁判据的 false 侧）')
        assert.equal(w.snapshotMaxChars, 8192)
    })
    test("env 严格 ==='true' 才开；名单逗号串切分去空", async () => {
        process.env.limits_skillWriteIdempotency = 'true'
        process.env.limits_skillWriteIdempotencyWriteTools = ' doc_api/upload , ppt/gen/* , ,'
        const mod = await import(`../../../../conf/system.config.js?v=${Math.random()}`)
        const w = mod.default.limits.skillWriteIdempotency
        delete process.env.limits_skillWriteIdempotency
        delete process.env.limits_skillWriteIdempotencyWriteTools
        assert.equal(w.enabled, true)
        assert.deepEqual(w.writeTools, ['doc_api/upload', 'ppt/gen/*'], '逗号切分必须去空白与空项')
    })
})

describe('grpcSkill：admin 判定=priv 真值主判据（属主判据——all 超管经 ucenter hasPriv 尊重，白名单只做兜底）', () => {
    const code = codeOnly(read('services/core/grpcSkill.js')).join('\n')

    test('priv 查询不跳过白名单用户（privGranted 恒真值，留痕 evidence 不失真）', () => {
        assert.doesNotMatch(code, /privCodes\.length[^)]*adminUserCodes\.includes/,
            '白名单短路回潮：白名单内超管不再被问 hasPriv——"all 尊重"退化成"名单内免检"，且审计 evidence.privGranted 恒 false')
        const calls = code.split('await checkPrivAdmin(').length - 1
        assert.equal(calls, 2, '写闸与审核闸两处都该查 priv 真值（实得 ' + calls + '=有闸漏配）')
    })
    test('checkPrivAdmin 走 grpc hasPriv（后端 privs 被网关清空，grpc 是唯一可信源）', () => {
        assert.match(code, /return \(await hasPriv\(userCode, privCodes\)\) === true/,
            'priv 判定不是 grpc hasPriv——照搬前端 privs.includes("all") 在后端恒 false（网关清空 privs）')
        assert.match(code, /catch \(e\) \{[\s\S]{0,200}return false/, 'hasPriv 失败必须 fail-closed（依赖故障自动放行=后门）')
    })
})
