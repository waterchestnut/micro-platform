/**
 * @fileOverview plan-e2e 三进程编排器（假中继 → server → 探针），底座刀七移植
 * @module evals/platform-probes/run-plan-e2e
 * @description
 * 母本用法是三段手敲命令（见 fake-relay-plan.mjs 头部）；PowerShell 里三段编排会把
 * 中文匹配串写坏（实测 GBK 重编码），所以做成 node 编排器：
 *   1. 起 fake-relay-plan（13031，观测文件）；
 *   2. 带 LLM_RELAY_BASE_URL 指过去 + plan_enabled/finalize_selfCheck 起 server.js（12031）；
 *   3. 监到"服务器启动成功"就发 plan-e2e-probe，探针退出码即本编排器退出码；
 *   4. 180s 看门狗兜底（server 起不来/探针卡死都给出可区分的退出码）。
 * 用法（底座 llm.api 目录下，先加载 .env 到环境）：node evals/platform-probes/run-plan-e2e.mjs
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const OBS = path.join(ROOT, 'tmp-planobs.json')
const PORT = '12031'
const RELAY_PORT = '13031'

const relay = spawn(process.execPath, ['evals/platform-probes/fake-relay-plan.mjs', `--port=${RELAY_PORT}`, `--observe=${OBS}`],
    { cwd: ROOT, stdio: 'ignore' })

const serve = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT, FASTIFY_ADDRESS: '127.0.0.1',
        LLM_RELAY_BASE_URL: `http://127.0.0.1:${RELAY_PORT}/v1`, plan_enabled: 'true', finalize_selfCheck: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
})

let fired = false
let probe = null
const onData = (d) => {
    const s = d.toString()
    if (fired) return
    // 只锚 ASCII 监听行，中文启动语在管道里编码不稳（监听行是 fastify 自己打的 `Server listening at`）
    if (s.includes('Server listening at')) {
        fired = true
        probe = spawn(process.execPath, ['evals/platform-probes/plan-e2e-probe.mjs', `--observe=${OBS}`],
            { cwd: ROOT, stdio: 'inherit', env: { ...process.env, PROBE_BASE: `http://127.0.0.1:${PORT}` } })
        probe.on('exit', (code) => {
            console.log(`== plan-e2e EXIT ${code} ==`)
            relay.kill(); serve.kill()
            setTimeout(() => process.exit(code ?? 9), 1200)
        })
    }
}
serve.stdout.on('data', onData)
serve.stderr.on('data', onData)

setTimeout(() => {
    console.log(fired ? '== WATCHDOG: probe 卡死 ==' : '== WATCHDOG: server 未就绪 ==')
    relay.kill(); serve.kill(); if (probe) probe.kill()
    process.exit(4)
}, 180000)
