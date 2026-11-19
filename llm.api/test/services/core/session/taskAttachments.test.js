/**
 * @fileOverview 附件授权通道判据的穷举用例（纯函数）
 * @module test/services/core/session/taskAttachments.test
 */
import {describe, test} from 'node:test'
import assert from 'node:assert/strict'
import {
    snapshotAttachmentAccess, decideAttachmentAccess, formatAttachmentsNote, DENY_MESSAGES,
} from '../../../../services/core/session/taskAttachments.js'

describe('snapshotAttachmentAccess（授权快照提取）', () => {
    test('正常 FileInfo 提 fileCode+name', () => {
        assert.deepEqual(snapshotAttachmentAccess([{fileCode: 'f1', name: '报告.pdf'}]), [{fileCode: 'f1', name: '报告.pdf'}])
    })
    test('缺 fileCode/空串/非串的项全滤掉；name 缺失留空不猜', () => {
        assert.deepEqual(snapshotAttachmentAccess([{name: '坏项'}, {fileCode: '  '}, {fileCode: 42}, {fileCode: 'f2'}]),
            [{fileCode: 'f2', name: ''}])
    })
    test('同 fileCode 去重先现者胜（重发附件不产生第二个授权位）', () => {
        assert.deepEqual(snapshotAttachmentAccess([{fileCode: 'f1', name: '第一版'}, {fileCode: 'f1', name: '第二版'}]),
            [{fileCode: 'f1', name: '第一版'}])
    })
    test('非数组/undefined ⇒ 空表（形状漂移不炸，交给判据的 no-snapshot 档说话）', () => {
        assert.deepEqual(snapshotAttachmentAccess(undefined), [])
        assert.deepEqual(snapshotAttachmentAccess('f1'), [])
    })
    test('fileCode 两端的空白被 trim 后进表（把手照抄带空格是常态）', () => {
        assert.equal(snapshotAttachmentAccess([{fileCode: ' f1 '}])[0].fileCode, 'f1')
    })
})

describe('decideAttachmentAccess（判定表穷举）', () => {
    const CTX = {rootCode: 'r1'}
    const SNAP = [{fileCode: 'f1', name: 'a.pdf'}]

    test('档位 in-snapshot：清单内放行', () => {
        assert.deepEqual(decideAttachmentAccess({taskContext: CTX, fileCode: 'f1', snapshot: SNAP}),
            {allow: true, reason: 'in-snapshot', fileCode: 'f1'})
    })
    test('档位 no-task-context 最优先：普通轮连快照都不该去查', () => {
        assert.deepEqual(decideAttachmentAccess({taskContext: null, fileCode: 'f1', snapshot: SNAP}),
            {allow: false, reason: 'no-task-context', message: DENY_MESSAGES['no-task-context']})
        assert.deepEqual(decideAttachmentAccess({taskContext: {}, fileCode: 'f1', snapshot: SNAP}).reason, 'no-task-context')
    })
    test('档位 bad-file-code：空/非串在身份之后立刻拒（不碰账）', () => {
        for (const bad of ['', '   ', undefined, null]) {
            assert.equal(decideAttachmentAccess({taskContext: CTX, fileCode: bad, snapshot: SNAP}).reason, 'bad-file-code', `code=${String(bad)}`)
        }
    })
    test('档位 root-unreadable：null 快照=不知道，站危险面', () => {
        assert.equal(decideAttachmentAccess({taskContext: CTX, fileCode: 'f1', snapshot: null}).reason, 'root-unreadable')
        assert.equal(decideAttachmentAccess({taskContext: CTX, fileCode: 'f1'}).reason, 'root-unreadable')
    })
    test('档位 no-snapshot：知道且确实没附件（与 root-unreadable 分开说——两句不同的真话）', () => {
        const d = decideAttachmentAccess({taskContext: CTX, fileCode: 'f1', snapshot: []})
        assert.deepEqual(d, {allow: false, reason: 'no-snapshot', message: DENY_MESSAGES['no-snapshot']})
        assert.notEqual(d.message, DENY_MESSAGES['root-unreadable'])
    })
    test('档位 not-in-snapshot：清单外就是红线违例，点名"授权红线"', () => {
        const d = decideAttachmentAccess({taskContext: CTX, fileCode: 'f9', snapshot: SNAP})
        assert.equal(d.allow, false)
        assert.equal(d.reason, 'not-in-snapshot')
        assert.match(d.message, /授权红线/)
    })
    test('放行比对用 trim 后的语义（快照里 f1、请求 " f1 " 也中——与提取侧同口径）', () => {
        // 判据侧 trim；快照项已是提取产物
        assert.equal(decideAttachmentAccess({taskContext: CTX, fileCode: ' f1 ', snapshot: SNAP}).allow, true)
    })
})

describe('formatAttachmentsNote（child 的清单注入）', () => {
    test('空清单 ⇒ 空串——query 逐字不变是红线（不注入也不留痕）', () => {
        assert.equal(formatAttachmentsNote([]), '')
        assert.equal(formatAttachmentsNote(undefined), '')
    })
    test('单条：name+fileCode+工具名都在文案里', () => {
        const n = formatAttachmentsNote([{fileCode: 'f1', name: '报告.pdf'}])
        assert.match(n, /报告\.pdf/)
        assert.match(n, /fileCode=f1/)
        assert.match(n, /read_attachment/)
    })
    test('多条逐行列；未具名如实标"未具名"不瞎编', () => {
        const n = formatAttachmentsNote([{fileCode: 'f1', name: 'a'}, {fileCode: 'f2', name: ''}])
        assert.match(n, /- a（fileCode=f1）/)
        assert.match(n, /- \(未具名\)（fileCode=f2）/)
    })
    test('工具名可覆盖（注册名换了文案跟着换，不留第二真相）', () => {
        assert.match(formatAttachmentsNote([{fileCode: 'f', name: 'x'}], 'my_tool'), /my_tool/)
    })
    test('DENY_MESSAGES 每档都是完整句子（回给模型的话不能是代号）', () => {
        for (const [k, v] of Object.entries(DENY_MESSAGES)) {
            assert.ok(typeof v === 'string' && v.length >= 10, `档位 ${k} 的话太短`)
        }
    })
})
