import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {normalizeRegeneratedFrom, allowsAnswerCache, regeneratedFromForArchive} from '../../../../services/core/session/regeneration.js'

/**
 * P3 最小安全版的服务端口径。
 *
 * 核心不是"能不能重跑"（前端本来就能重发同一个问题），而是两件不能靠前端自觉的事：
 * 重跑必须绕开答案缓存，以及"这一轮是重跑"必须能在档案里核对。
 */

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
/**
 * @description 读源文件代码行（去 CR、去注释）
 * @param {String} rel 相对 src 路径
 * @returns {String[]} 行
 */
function codeOf(rel) {
    return fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r/g, '').split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l.trim()))
}

describe('normalizeRegeneratedFrom：宽容接收、严格归一', () => {
    test('正常字符串原样保留（两端空白裁掉）', () => {
        assert.equal(normalizeRegeneratedFrom('msg-1'), 'msg-1')
        assert.equal(normalizeRegeneratedFrom('  msg-1  '), 'msg-1')
    })

    test('空串、纯空白、超长都视作"没有"', () => {
        for (const bad of ['', '   ', 'x'.repeat(129)]) {
            assert.equal(normalizeRegeneratedFrom(bad), null, `长度 ${bad.length} 不该被当成来源`)
        }
    })

    test('非字符串一律 null，不抛（前端多传对象不该把这轮变成 error 行）', () => {
        for (const bad of [undefined, null, 0, 1, true, false, {}, [], ['msg'], Symbol('s')]) {
            assert.doesNotThrow(() => normalizeRegeneratedFrom(bad))
            assert.equal(normalizeRegeneratedFrom(bad), null)
        }
    })

    test('128 正好可用、129 不可用（与 messageCode 同尺）', () => {
        assert.equal(normalizeRegeneratedFrom('m'.repeat(128)), 'm'.repeat(128))
        assert.equal(normalizeRegeneratedFrom('m'.repeat(129)), null)
    })
})

describe('allowsAnswerCache：重跑绝不走缓存', () => {
    test('有来源 ⇒ 即使原本有缓存资格也拒', () => {
        assert.equal(allowsAnswerCache({cacheEligible: true, regeneratedFrom: 'msg-1'}), false)
    })

    test('无来源 ⇒ 完全尊重原本的资格，不改变既有行为', () => {
        assert.equal(allowsAnswerCache({cacheEligible: true, regeneratedFrom: null}), true)
        assert.equal(allowsAnswerCache({cacheEligible: false, regeneratedFrom: null}), false)
    })

    test('空字符串不算来源（归一后是 null，但这里也不能被 falsy 之外的东西糊弄）', () => {
        assert.equal(allowsAnswerCache({cacheEligible: true, regeneratedFrom: ''}), true)
    })

    test('不传参数不抛，且默认不走缓存', () => {
        assert.doesNotThrow(() => allowsAnswerCache())
        assert.equal(allowsAnswerCache(), false)
    })

    test('cacheEligible 非严格 true 不放行（字符串 "true" 不算）', () => {
        assert.equal(allowsAnswerCache({cacheEligible: 'true', regeneratedFrom: null}), false)
        assert.equal(allowsAnswerCache({cacheEligible: 1, regeneratedFrom: null}), false)
    })
})

describe('regeneratedFromForArchive：写 null，不写缺键', () => {
    test('有值原样、无值 null（H1 的教训：缺键与"确认没有"是两件事）', () => {
        assert.equal(regeneratedFromForArchive('msg-1'), 'msg-1')
        for (const bad of [null, undefined, '', 0, {}, []]) {
            assert.equal(regeneratedFromForArchive(bad), null)
        }
    })
})

describe('接线：判据算出来了，还得真的被用', () => {
    const chat = codeOf('services/core/llmChat.js')

    test('来源在缓存分支之前就被归一（顺序错了就等于没绕开缓存）', () => {
        const norm = chat.findIndex((l) => /normalizeRegeneratedFrom\(options\.regeneratedFrom\)/.test(l))
        const cacheRead = chat.findIndex((l) => /getAnswerCache\(/.test(l))
        assert.ok(norm >= 0, 'llmChat 没有归一来源')
        assert.ok(cacheRead >= 0, '找不到缓存读取点（形状变了，本条要重写）')
        assert.ok(norm < cacheRead, `归一应在缓存读取之前，实际 norm=${norm + 1} cacheRead=${cacheRead + 1}`)
    })

    test('缓存资格必须经过 allowsAnswerCache（不能只在注释里说绕开）', () => {
        assert.ok(chat.some((l) => /cacheEligible\s*=\s*allowsAnswerCache\(/.test(l)), '没有真正改写 cacheEligible')
    })

    test('来源必须落进档案，且恰好一处', () => {
        const hits = chat.filter((l) => /regeneratedFrom:\s*regeneratedFromForArchive\(regeneratedFrom\)/.test(l))
        assert.equal(hits.length, 1, `落库点应恰好一处，实际 ${hits.length}`)
    })

    test('schema 必须声明这个键：否则 strict 通道会把它当未声明字段（审计告警、且可能被剥掉）', () => {
        const s = codeOf('schemas/chatStreamSchema.js')
        assert.ok(s.some((l) => /regeneratedFrom:\s*\{type:\s*'string'/.test(l)), 'schema 未声明 regeneratedFrom')
    })

    test('视图必须透出它，前端才可能说出"这是重跑的那条"', () => {
        const v = codeOf('services/core/messageView.js')
        assert.ok(v.some((l) => /regeneratedFrom:\s*info\.regeneratedFrom \|\| null/.test(l)), '视图没带 regeneratedFrom')
    })
})
