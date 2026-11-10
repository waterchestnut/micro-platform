import {test, describe} from 'node:test'
import * as assert from 'node:assert'

/**
 * `client.js` 在模块加载时就读 `llm.config.kafka` / `llm.logger`，
 * 沿用仓库离线用例的形状：先立全局，再动态 import 被测模块。
 */
global.llm = global.llm || {
    logger: {info() {}, warn() {}, error() {}},
    config: {
        kafka: {
            clientId: 'test-client',
            brokers: ['127.0.0.1:9092'],
            retry: {},
            sasl: {},
            autocreateTopics: false,
            topics: {},
        },
    },
    tools: {},
}

const {registerErrorHandler} = await import('../../../daos/kafka/client.js')

/**
 * @description 造一个只记账的假 consumer
 * @param {Array<String>} order 顺序记录
 * @param {Object} [opt] 选项
 * @returns {Object} consumer 替身
 */
function fakeConsumer(order, opt = {}) {
    return {
        on() {},
        once() {},
        close: async () => {
            order.push('close')
            if (opt.closeThrows) {
                throw new Error('close 失败')
            }
        },
    }
}

/**
 * @description registerErrorHandler 会往 process 上装 uncaughtException / unhandledRejection 处理器，
 * 其中带 `process.exit(1)`。用例跑完必须把监听器恢复原样，
 * 否则后面任何一条用例的偶发 rejection 都会把整个测试进程按掉 —— 那会被读成"套件自己炸了"。
 * @param {Function} fn 用例体
 * @returns {Promise<void>} 结果
 */
async function isolated(fn) {
    const kinds = ['uncaughtException', 'unhandledRejection', 'SIGTERM', 'SIGINT']
    const snap = kinds.map(k => [k, process.listeners(k)])
    try {
        await fn()
    } finally {
        for (const [k, list] of snap) {
            process.removeAllListeners(k)
            list.forEach(l => process.on(k, l))
        }
    }
}

/**
 * @description 等异步处理器把 microtask 走完
 * @returns {Promise<void>} 结果
 */
const tick = () => new Promise(r => setTimeout(r, 10))

describe('registerErrorHandler 的停机顺序', () => {
    test('核心不变量：先排空在途（onSignal）→ 再 close → 才退出。顺序颠倒就是把已提交的活作废', async () => {
        await isolated(async () => {
            const order = []
            registerErrorHandler(fakeConsumer(order), {
                onSignal: async () => {
                    order.push('onSignal')
                },
                exit: (code) => order.push(`exit:${code}`),
            })
            process.emit('SIGTERM')
            await tick()
            assert.deepEqual(order, ['onSignal', 'close', 'exit:0'],
                'close 会关掉连接，之后的 message.commit() 必然失败 ⇒ 排空必须在 close 之前')
        })
    })

    test('排空自己抛错时仍要 close：不 leave group 的话，别的成员要白等 sessionTimeout 30s', async () => {
        await isolated(async () => {
            const order = []
            registerErrorHandler(fakeConsumer(order), {
                onSignal: async () => {
                    order.push('onSignal')
                    throw new Error('排空炸了')
                },
                exit: (code) => order.push(`exit:${code}`),
            })
            process.emit('SIGTERM')
            await tick()
            assert.deepEqual(order, ['onSignal', 'close', 'exit:0'],
                '排空异常不能吃掉 close，否则停机更慢而不是更快')
        })
    })

    test('close 失败也必须退出：卡到 grace 到点被 SIGKILL 不算优雅', async () => {
        await isolated(async () => {
            const order = []
            registerErrorHandler(fakeConsumer(order, {closeThrows: true}), {
                onSignal: async () => {
                    order.push('onSignal')
                },
                exit: (code) => order.push(`exit:${code}`),
            })
            process.emit('SIGINT')
            await tick()
            assert.deepEqual(order, ['onSignal', 'close', 'exit:0'])
        })
    })

    test('没传 hooks 时行为不变（close + 退出），保证这次改动不要求两个入口同时改', async () => {
        await isolated(async () => {
            const order = []
            registerErrorHandler(fakeConsumer(order), {exit: (code) => order.push(`exit:${code}`)})
            process.emit('SIGTERM')
            await tick()
            assert.deepEqual(order, ['close', 'exit:0'])
        })
    })

    test('信号只处理一次：重复 SIGTERM 不得二次 close（`process.once` 的语义要在调用方成立）', async () => {
        await isolated(async () => {
            const order = []
            registerErrorHandler(fakeConsumer(order), {
                onSignal: async () => {
                    order.push('onSignal')
                },
                exit: () => order.push('exit'),
            })
            process.emit('SIGTERM')
            await tick()
            process.emit('SIGTERM')
            await tick()
            assert.equal(order.filter(x => x === 'close').length, 1)
            assert.equal(order.filter(x => x === 'exit').length, 1)
        })
    })
})
