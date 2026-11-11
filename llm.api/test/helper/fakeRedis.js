/**
 * @fileOverview 事件镜像的假 redis（只实现用到的四个命令，语义尽量贴 ioredis）
 * @module test/helper/fakeRedis
 * @description
 * 只实现 `xadd`（含 `MAXLEN ~` 截断）、`xrange`、`expire`、`pipeline`、`del`。
 * 截断实现成**精确**丢弃最老的（超过 cap 就裁）。**这与真 Redis 不一样**：
 * 真的 `MAXLEN ~` 按宏节点边界近似修剪——dev 实测把 cap 设成 5，一轮 67 帧之后
 * 键里还剩 37 条（seq 32..67）。所以**"近似修剪的真实行为不能靠这份假库证明"**，
 * 它只证明"我们发出了带 `~` 的命令 + 读侧对洞的判断正确"。
 * 真行为记在 `runEventLogStore.js` 的文件头，用例 `我们发的是近似修剪` 只钉住命令形状。
 */

/**
 * @description 造一个假客户端
 * @param {Object} [opt] 选项
 * @param {Boolean} [opt.throwOnWrite] 写就抛（模拟 redis 挂了）
 * @param {Boolean} [opt.throwOnRead] 读就抛
 * @returns {Object} 客户端
 */
export function createFakeRedis({throwOnWrite = false, throwOnRead = false} = {}) {
    const streams = new Map()
    const ttls = new Map()
    let idSeq = 0
    const calls = {xadd: 0, xrange: 0, expire: 0, pipelines: 0}

    /**
     * @description 内部追加
     * @param {String} key 键
     * @param {Array<String|Number>} args xadd 参数（已去掉 MAXLEN 部分）
     * @param {Number} cap 容量
     * @returns {String} 条目 id
     */
    function push(key, args, cap) {
        const list = streams.get(key) || []
        const flat = []
        for (let i = 0; i < args.length; i += 2) {
            flat.push(String(args[i]), String(args[i + 1]))
        }
        idSeq++
        list.push([`0-${idSeq}`, flat])
        if (cap > 0 && list.length > cap) {
            list.splice(0, list.length - cap)
        }
        streams.set(key, list)
        return `0-${idSeq}`
    }

    const client = {
        calls,
        streams,
        ttls,
        async xadd(key, ...args) {
            calls.xadd++
            /** 原样记下最后一次参数：要断言"我们发的是近似修剪 `~`"，改精确必须是有意识的动作 */
            client.lastXadd = {key, args: args.slice()}
            if (throwOnWrite) {
                throw new Error('READONLY: 写被拒')
            }
            /**
             * 两种参数形状要分开切，切错一格就会把字段名当值：
             *   `MAXLEN ~ 3 * seq 1 ...` → 字段从下标 4 起
             *   `* seq 1 ...`            → 字段从下标 1 起
             */
            let cap = 0
            let fields
            if (args[0] === 'MAXLEN') {
                const approximate = args[1] === '~'
                cap = Number(args[approximate ? 2 : 1])
                fields = args.slice(approximate ? 4 : 3)
            } else {
                fields = args.slice(1)
            }
            return push(key, fields, cap)
        },
        async xrange(key) {
            calls.xrange++
            if (throwOnRead) {
                throw new Error(' Connection is closed.')
            }
            return streams.get(key) || []
        },
        async expire(key, sec) {
            ttls.set(key, sec)
            return 1
        },
        async del(key) {
            return streams.delete(key) ? 1 : 0
        },
        pipeline() {
            calls.pipelines++
            const ops = []
            const pipe = {
                xadd(...a) {
                    ops.push(() => client.xadd(...a))
                    return pipe
                },
                expire(...a) {
                    ops.push(() => client.expire(...a))
                    return pipe
                },
                async exec() {
                    const out = []
                    for (const op of ops) {
                        out.push([null, await op()])
                    }
                    return out
                },
            }
            return pipe
        },
    }
    return client
}
