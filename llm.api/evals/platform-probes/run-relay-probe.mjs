/**
 * @fileOverview 假中继类探针的通用三进程编排器（底座刀七；run-plan-e2e 的推广版）
 * @module evals/platform-probes/run-relay-probe
 * @description
 * 母本把"起假中继 → 起 server → 发探针"写成每个探针头部的 PowerShell 三行——在 Windows
 * 上手工编排会把中文哨兵写坏（实测），也复现不了"监听行出现才发探针"的时序。本编排器
 * 参数化这一族：
 *   node evals/platform-probes/run-relay-probe.mjs \
 *     --relay=fake-relay-abort.mjs --relay-args=--port=13018 --relay-args=--rounds=2 ... \
 *     --port=12018 --probe=finalize-interrupt-probe.mjs --probe-args=--cut=2500
 * 约定：
 * - `--relay=` 省略 ⇒ 不起假中继（server 用环境里的真 relay，如 interrupt-attribution 的真实轮）；
 * - server 就绪哨兵用 **ASCII** 的 `Server listening at`（中文启动语在管道里编码不稳）；
 * - server 环境自动注入 `PORT/FASTIFY_ADDRESS/LLM_RELAY_BASE_URL`（有假中继时）；
 *   其余开关（plan_enabled/finalize_selfCheck…）由调用方 shell 环境预置（继承）；
 * - 探针 env 注入 `PROBE_BASE=http://127.0.0.1:<port>`；`--probe-env=K=V` 可再补；
 * - 退出码=探针退出码；180s 看门狗报"未就绪/卡死"两种可区分形态。
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const argv = process.argv.slice(2)
const val = (n) => { const h = argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : '' }
const many = (n) => argv.filter((a) => a.startsWith(`--${n}=`)).map((a) => a.slice(n.length + 3))

const RELAY = val('relay')
const RELAY_ARGS = many('relay-args')
const PORT = val('port') || '12031'
const PROBE = val('probe')
if (!PROBE) { console.log('缺 --probe='); process.exit(9) }

let relay = null
const serverEnv = { ...process.env, PORT, FASTIFY_ADDRESS: '127.0.0.1' }
if (RELAY) {
    const relayPort = (RELAY_ARGS.find((a) => a.startsWith('port=')) || 'port=13031').replace('port=', '')
    relay = spawn(process.execPath, [`evals/platform-probes/${RELAY}`, ...RELAY_ARGS.map((a) => `--${a}`)], { cwd: ROOT, stdio: 'ignore' })
    serverEnv.LLM_RELAY_BASE_URL = `http://127.0.0.1:${relayPort}/v1`
}

const serve = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: serverEnv, stdio: ['ignore', 'pipe', 'pipe'] })
let fired = false
const onData = (d) => {
    if (fired) { return }
    if (d.toString().includes('Server listening at')) {
        fired = true
        const probeEnv = { ...process.env, PROBE_BASE: `http://127.0.0.1:${PORT}` }
        for (const kv of many('probe-env')) { const i = kv.indexOf('='); if (i > 0) { probeEnv[kv.slice(0, i)] = kv.slice(i + 1) } }
        const probe = spawn(process.execPath, [`evals/platform-probes/${PROBE}`, ...many('probe-args')], { cwd: ROOT, stdio: 'inherit', env: probeEnv })
        probe.on('exit', (code) => {
            console.log(`== ${PROBE} EXIT ${code} ==`)
            if (relay) { relay.kill() }
            serve.kill()
            setTimeout(() => process.exit(code ?? 9), 1200)
        })
    }
}
serve.stdout.on('data', onData)
serve.stderr.on('data', onData)
setTimeout(() => {
    console.log(fired ? '== WATCHDOG: probe 卡死 ==' : '== WATCHDOG: server 未就绪 ==')
    if (relay) { relay.kill() }
    serve.kill()
    process.exit(4)
}, 180000)
