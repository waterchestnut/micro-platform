import {test, describe, beforeEach} from 'node:test'
import * as assert from 'node:assert'
import {
    beginShutdown,
    isClosing,
    shutdownStatus,
    resetForTest,
} from '../../../../services/core/session/shutdownState.js'
import {socketCloseAbortDecision} from '../../../../services/core/session/shutdownPolicy.js'

/**
 * 停机状态位。
 * 它唯一的职责是让"用户按停止"与"发版拆连接"这两件事在进程内可分辨——
 * 因为 HTTP 层给不出这个区别（两边都是 `request.raw.destroyed === true`），
 * 而这两种情况的正确处置是**相反的**。
 */
beforeEach(() => {
    resetForTest()
})

describe('beginShutdown / isClosing', () => {
    test('初始不是关闭态：正常服务期间 socket 断开仍按"用户打断"处理', () => {
        assert.equal(isClosing(), false)
        assert.deepEqual(socketCloseAbortDecision({closing: isClosing(), destroyed: true}),
            {abort: true, reason: 'client-disconnect'})
    })

    test('置位后 isClosing 为真，且同一断开改判为"不打断"', () => {
        beginShutdown({signal: 'SIGTERM'})
        assert.equal(isClosing(), true)
        assert.deepEqual(socketCloseAbortDecision({closing: isClosing(), destroyed: true}),
            {abort: false, reason: 'shutdown-draining'})
    })

    test('置位是单向的：重复 beginShutdown 不覆盖首个信号与起始时刻', () => {
        beginShutdown({signal: 'SIGTERM', now: () => 1000})
        beginShutdown({signal: 'SIGINT', now: () => 9000})
        const st = shutdownStatus({now: () => 4000})
        assert.equal(st.signal, 'SIGTERM', '第一次的信号才是原因，第二次不该改写现场')
        assert.equal(st.since, 1000)
        assert.equal(st.elapsedMs, 3000)
    })

    test('resetForTest 只给测试用：线上回退会把半途的停机当成没发生', () => {
        beginShutdown({signal: 'SIGTERM'})
        assert.equal(isClosing(), true)
        resetForTest()
        assert.equal(isClosing(), false)
        assert.equal(shutdownStatus().elapsedMs, 0, '非关闭态时 elapsedMs 必须是 0，不能留着上次的数')
    })

    test('没给 signal 时也不能崩（manual close 走的正是这条路）', () => {
        beginShutdown({manual: true})
        assert.equal(isClosing(), true)
        assert.equal(shutdownStatus().signal, '')
    })
})
