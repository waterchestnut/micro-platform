import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

/**
 * M6 credits 的**接线**不变量（口径本身在 creditMeter.test.js 穷举）。
 * 钉三件只能在源码形状上钉的事：
 * 1. llmChat 的**两处**落账点（在途 touchInflight / 收尾 upsertByMessageCode）都展平同一个 helper——
 *    "双处白名单一致"靠共用构造器成立，不靠"记得两边都改"（§2E-2 漂移病在这里的解法）。
 * 2. 读取侧（agentChat 的树账）**不自己算 credits**：它只从 child 自己的 llmUsage 行取——
 *    handler 里出现 computeCredits 就是第二套口径，D66 预备役。
 * 3. 权重只从 `config.credits.weights` 注入，两处同源。
 */
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
function read(rel) {
    return fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r/g, '')
}

describe('M6 落账双处一致', () => {
    const chat = read('services/core/llmChat.js')

    test('两处落账点各调一次 buildUsageCreditsFields（少一处=两列在途/收尾语义分叉）', () => {
        const hits = [...chat.matchAll(/buildUsageCreditsFields\(\{/g)].length
        assert.equal(hits, 2, `应恰好 2 处调用（在途+收尾），实际 ${hits}`)
        assert.ok(/touchInflight\(\{[\s\S]{0,1200}buildUsageCreditsFields\(/.test(chat), '在途刷新没带 credits')
        assert.ok(/upsertByMessageCode\(\{[\s\S]{0,2000}buildUsageCreditsFields\(/.test(chat), '收尾落账没带 credits')
    })

    test('两处同源权重：都取 config.credits?.weights，不许一处硬编', () => {
        const w = [...chat.matchAll(/weights:\s*config\.credits\?\.weights/g)].length
        assert.equal(w, 2, `权重注入点应 2 处同源，实际 ${w}`)
        assert.ok(/import \{buildUsageCreditsFields\} from '\.\/session\/creditMeter\.js'/.test(chat), 'helper 未从唯一口径模块引入')
    })

    test('读取侧不重算：agentChat 只从 llmUsage 行取 credits（出现计算口径=第二套账）', () => {
        const ac = read('services/agent/handler/agentChat.js')
        assert.match(ac, /llmUsageDac\.getByCode\(childMessageCode\)/, '没读 child 自己的用量行')
        assert.ok(!/computeCredits|buildUsageCreditsFields/.test(ac),
            'agentChat 自己算 credits=第二套口径；树账要求同源，缺就缺席（rollup 少计好过多造）')
    })

    test('§5-4 关联列双处一致：llmChat 两处落账都过同一提取器；三个执行体都带 taskContext', () => {
        const chat = read('services/core/llmChat.js')
        const tf = [...chat.matchAll(/\.\.\.extractTaskFields\(\{taskContext: options\.taskContext\}\)/g)].length
        assert.equal(tf, 2, `关联列写入点应恰好 2 处同源（在途+收尾），实际 ${tf}`)
        for (const [file, role] of [
            ['services/agent/handler/agentChat.js', "'child'"],
            ['services/agent/handler/turnRunner.js', "'serialized-turn'"],
            ['services/agent/handler/fanOutFinalizeTask.js', "'synthesis'"],
        ]) {
            assert.ok(read(file).includes(`agentRole: ${role}`), `${file} 未带 taskContext.agentRole=${role}`)
        }
    })

    test('§5-4 追活预算闸接进 follow 循环（budgetGate 缺失=并行裸奔回潮）', () => {
        const follow = read('services/agent/fanOutFollow.js')
        assert.match(follow, /p\.budgetGate/, '循环里没有预算闸的位置')
        assert.match(follow, /budget-exhausted/, '闸拦下后没有如实的 degrade 态')
        const fin = read('services/agent/handler/fanOutFinalizeTask.js')
        assert.match(fin, /budgetGate: async/, 'finalize 没把闸接上（列了位置没接线=假装有闸）')
        assert.match(fin, /budgetUsedTokens/, '树 token 累计没写回 root')
    })

    test('§5-4 后半 runStats 消费面：usageDaily 在返回体且只查本人（底座刀四实锤：这行没守卫，搬漏过一次）', () => {
        const root = read('routes/core/chat/root.js')
        const rs = root.slice(root.indexOf("fastify.post('/runStats'"))
        assert.match(rs, /import\('\.\.\/\.\.\/\.\.\/services\/core\/usageStats\.js'\)/, 'runStats 没接 usageStats（单源面被绕开）')
        assert.match(rs, /getUserDailyUsage\(request\.userInfo\.userCode/, '日汇总没锁本人 userCode（可传任意人=枚举他人消耗）')
        assert.match(rs, /usageDaily,/, 'usageDaily 没进返回体')
    })
})
