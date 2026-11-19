import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {
    INTERNAL_CONVERSATION_PREFIXES,
    isInternalConversationCode,
    LIST_EXCLUDE_INTERNAL,
} from '../../../../daos/core/policy/conversationVisibility.js'

/**
 * 会话可见性（工作会话不进列表）的判据穷举 + 接线守卫。
 * 判错的代价两种：把用户主会话标 internal（**会话从列表消失=数据像被删**）比
 * 漏标（列表多几条噪音）严重得多——所以"不知道"一律 false 是地基，用例先钉它。
 */
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const codeOnly = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r/g, '')
    .split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l.trim()))

describe('isInternalConversationCode 判据', () => {
    test('前缀表就是隔离会话命名的全集（新增形态必须显式进表，不许 regex 兜底）', () => {
        assert.deepEqual(INTERNAL_CONVERSATION_PREFIXES, ['root:', 'agent:'])
    })
    test('root:/agent: 命中；普通 uuid 与业务会话码不命中', () => {
        assert.equal(isInternalConversationCode('root:2cfe95e0e3af11f1'), true)
        assert.equal(isInternalConversationCode('agent:62559080e3b011f1'), true)
        assert.equal(isInternalConversationCode('56cb4910e3ab11f193cd4117f6a18346'), false)
        assert.equal(isInternalConversationCode('mentor_x1'), false)
    })
    test('"不知道"一律 false：非串/空串/前缀相似但不带冒号（防误标用户主会话=防"会话消失"）', () => {
        for (const bad of [null, undefined, '', 42, {}, ['root:1'], 'root', 'rootx:1', 'Root:1', ' agent:1']) {
            assert.equal(isInternalConversationCode(bad), false, `不该被标内部：${JSON.stringify(bad)}`)
        }
    })
})

describe('接线守卫：写点、读点、权限分离三处缺一不可', () => {
    test('写点：llmChat 建档时按判据落 internal（创建者固化语义，读取侧此后只看字段）', () => {
        const chat = codeOnly('services/core/llmChat.js')
        assert.ok(chat.some((l) => /^import \{isInternalConversationCode\}.*conversationVisibility/.test(l)), 'llmChat 没导入判据')
        const add = chat.findIndex((l) => /conversationDac\.add\(\{/.test(l))
        assert.ok(add >= 0, '找不到建档点')
        const seg = chat.slice(add, add + 20).join('\n')
        assert.match(seg, /internal:\s*isInternalConversationCode\(conversationCode\)/, '建档没落 internal 判定')
    })

    test('读点：list 路由在调用方 filter **之后**硬置排除（spread 顺序=覆盖方向，放前面调用方能翻盘）', () => {
        const route = codeOnly('routes/core/conversation/root.js')
        const spread = route.findIndex((l) => /\.\.\.request\.reqParams\.filter/.test(l))
        const excl = route.findIndex((l) => /\.\.\.LIST_EXCLUDE_INTERNAL/.test(l))
        assert.ok(spread >= 0 && excl > spread, `排除条件必须在 filter 之后（spread=${spread + 1} excl=${excl + 1}）`)
    })

    test('权限分离：成员校验的 getConversationCodes 查询**不许**带 internal 过滤（byCode 读综合正文的命脉）', () => {
        const dac = codeOnly('daos/core/dac/conversationDac.js').join('\n')
        const fn = dac.slice(dac.indexOf('async getConversationCodes'), dac.indexOf('async getConversationCodes') + 900)
        assert.ok(fn.length > 100, '找不到 getConversationCodes')
        assert.ok(!/internal/.test(fn), 'allowedCodes 查询被加了 internal 过滤 ⇒ internal 会话 byCode 读会 403，本方案地基塌陷')
    })

    test('LIST_EXCLUDE_INTERNAL 语义是 $ne:true（缺键的历史行也算可见，回填前不误伤）', () => {
        assert.deepEqual(LIST_EXCLUDE_INTERNAL, {internal: {$ne: true}})
    })

    test('dac 键白名单认下 internal（第四种"静默丢弃"家族：filter 键未组进查询=排除形同虚设）', () => {
        /**
         * 行为面由 e2e `conv-visibility-e2e` V2 真跑钉（列表首屏无 root:/agent: 泄漏——
         * **正是它抓出"路由传了 {$ne:true} 但 dac 白名单没组进查询"这一红**）。
         * 这里守源码位：assembleParams 必须有 internal 分支且操作符对象/$eq 归一两形都在——
         * 谁把分支删了，e2e 之前先在单测红。
         */
        const dacSrc = codeOnly('daos/core/dac/conversationDac.js').join('\n')
        assert.match(dacSrc, /if \(!tools\.isUndefined\(options\.internal\)\) \{/, 'conversationDac.assembleParams 没有 internal 分支（未认键会被静默丢弃，V2 之红复发）')
        assert.match(dacSrc, /isOperatorObject \? v : \{\$eq: v\}/, '操作符对象/$eq 归一两形缺一')
    })
})
