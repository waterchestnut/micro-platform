import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import {installGrpcShutdown} from '../../grpc/shutdown.js'

/**
 * gRPC 停机的顺序断言。
 * 背景：deployment 的 PID 1 已经是 node，而 grpc/server.js 此前**没有任何信号处理器**
 * ⇒ 翻入口之后 SIGTERM 的默认语义是"立即终止"，在途 RPC 当场被切。
 * 这几条用例就是为了让"再退回去"变得不可能。
 */

/**
 * @description 造一个可编程的假 grpc server
 * @param {Object} [opt] 选项
 * @returns {Object} 替身与计数
 */
function fakeServer(opt = {}) {
    const s = {tryCalls: 0, forceCalls: 0, cb: null}
    s.tryShutdown = (cb) => {
        s.tryCalls += 1
        s.cb = cb
        if (opt.throws) {
            throw new Error('bind 没了')
        }
        if (opt.autoDone) {
            setTimeout(() => cb(opt.err || null), 5)
        }
    }
    s.forceShutdown = () => {
        s.forceCalls += 1
    }
    return s
}

/**
 * @description 造一套注入用的 handlers / 退出记账 / 日志
 * @returns {Object} 部件
 */
function harness() {
    const handlers = {}
    const exits = []
    const lines = []
    const logger = {info: (m) => lines.push(String(m)), warn: (m) => lines.push(String(m)), error: (m) => lines.push(String(m))}
    return {
        handlers,
        exits,
        lines,
        logger,
        onSignal: (sig, fn) => {
            handlers[sig] = fn
        },
        exit: (code) => exits.push(code),
    }
}

describe('installGrpcShutdown', () => {
    test('SIGTERM ⇒ tryShutdown；在途跑完才 exit(0)', async () => {
        const h = harness()
        const s = fakeServer({autoDone: true})
        installGrpcShutdown({server: s, ...h, env: {}})
        assert.ok(h.handlers.SIGTERM && h.handlers.SIGINT, '两个信号都要注册')
        h.handlers.SIGTERM()
        await new Promise(r => setTimeout(r, 40))
        assert.equal(s.tryCalls, 1)
        assert.equal(s.forceCalls, 0, '在途能跑完就不该强杀')
        assert.deepEqual(h.exits, [0])
        assert.match(h.lines.join('\n'), /停机完成/)
    })

    test('重复信号不得二次 tryShutdown（停机流程必须幂等）', async () => {
        const h = harness()
        const s = fakeServer({autoDone: true})
        installGrpcShutdown({server: s, ...h, env: {}})
        h.handlers.SIGTERM()
        h.handlers.SIGINT()
        h.handlers.SIGTERM()
        await new Promise(r => setTimeout(r, 40))
        assert.equal(s.tryCalls, 1)
        assert.deepEqual(h.exits, [0])
        assert.match(h.lines.join('\n'), /重复信号被忽略/)
    })

    test('超预算 ⇒ forceShutdown 并退出：一个挂住的调用不能把停机拖到被 SIGKILL', async () => {
        const h = harness()
        const s = fakeServer({autoDone: false})
        installGrpcShutdown({server: s, ...h, env: {GRPC_SHUTDOWN_TIMEOUT_MS: '1200'}})
        h.handlers.SIGTERM()
        await new Promise(r => setTimeout(r, 400))
        assert.equal(s.forceCalls, 0, '400ms 时不该已经强杀')
        await new Promise(r => setTimeout(r, 1200))
        assert.equal(s.forceCalls, 1)
        assert.deepEqual(h.exits, [0])
        assert.match(h.lines.join('\n'), /超预算 1200ms/)
    })

    test('强杀之后迟到的 tryShutdown 回调不得把流程改回去、也不得二次退出', async () => {
        const h = harness()
        const s = fakeServer({autoDone: false})
        installGrpcShutdown({server: s, ...h, env: {GRPC_SHUTDOWN_TIMEOUT_MS: '1000'}})
        h.handlers.SIGTERM()
        await new Promise(r => setTimeout(r, 1300))
        assert.equal(s.forceCalls, 1)
        s.cb(null)
        await new Promise(r => setTimeout(r, 20))
        assert.deepEqual(h.exits, [0], '只能退出一次')
    })

    test('预算仍受 grace 与 preStop 钳制（与 http/kafka 同一份判据，不许自造一套）', () => {
        const h = harness()
        const s = fakeServer()
        installGrpcShutdown({
            server: s,
            ...h,
            env: {GRPC_SHUTDOWN_TIMEOUT_MS: '99000', TERM_GRACE_PERIOD_SECONDS: '20', PRE_STOP_SECONDS: '5'},
        })
        h.handlers.SIGTERM()
        /** 20s − 5s preStop − 5s 余量 = 10s */
        assert.match(h.lines.join('\n'), /预算=10000ms\(clamped/)
    })

    test('tryShutdown 抛出时 exit(1)：静默活着最坏，因为它还在接新调用', () => {
        const h = harness()
        const s = fakeServer({throws: true})
        installGrpcShutdown({server: s, ...h, env: {}})
        h.handlers.SIGTERM()
        assert.deepEqual(h.exits, [1])
        assert.match(h.lines.join('\n'), /tryShutdown 抛出/)
    })
})
