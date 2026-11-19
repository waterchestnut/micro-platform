/**
 * @fileOverview skill 写面幂等闸取证用假中继：同 toolCallId 换工具名的剧本
 * @module evals/platform-probes/fake-relay-write
 * @description
 * 配合 `skill-write-e2e-probe.mjs`。剧本三轮：
 * 1. 无工具结果的请求 ⇒ 交回 toolCall {id: call_w_1, name: probe_write/toolA}；
 * 2. 带一份工具结果的请求 ⇒ **同一个 id call_w_1、换工具名 probe_write/toolB**；
 *    这一轮是判据的心脏：如果闸门在起作用，运行侧会把 toolA 的快照回放（toolB 根本没执行），
 *    中继在第 3 轮请求里读到的 tool 消息会提 toolA；如果闸没起作用（对照组），读到的是 toolB。
 * 3. 带两份工具结果的请求 ⇒ 交回正文 stop，循环收尾。
 * 每轮把请求里的 tool 消息 content 抄进 --observe 文件，探针据此判"重放 vs 真执行"，
 * 零真 token。
 * 用法：node evals/platform-probes/fake-relay-write.mjs --port=13049 --observe=<路径>
 */
import http from 'node:http'
import fs from 'node:fs'

const argv = process.argv.slice(2)
const val = (n, d) => {
    const hit = argv.find((a) => a.startsWith(`--${n}=`))
    return hit ? hit.slice(n.length + 3) : d
}
const PORT = Number(val('port', 13049))
const OBSERVE = val('observe', '')

const obs = {toolRounds: 0, toolResults: [], notes: []}
const flush = () => { if (OBSERVE) fs.writeFileSync(OBSERVE, JSON.stringify(obs), 'utf8') }

function chunk(delta, finish) {
    return 'data: ' + JSON.stringify({
        id: 'fake', object: 'chat.completion.chunk', created: 1, model: 'fake',
        choices: [{index: 0, delta, finish_reason: finish || null}],
        usage: {prompt_tokens: 5, completion_tokens: 5, total_tokens: 10},
    }) + '\n\n'
}

function toolCallFrame(id, name) {
    return chunk({role: 'assistant', tool_calls: [{index: 0, id, type: 'function', function: {name, arguments: '{"note":"探针写面调用"}'}}]}, 'tool_calls')
}

function sse(res, frames) {
    res.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive'})
    for (const f of frames) res.write(f)
    res.write('data: [DONE]\n\n')
    res.end()
}

http.createServer((req, res) => {
    if (req.method !== 'POST') {
        res.writeHead(200, {'Content-Type': 'application/json'})
        res.end('{}')
        return
    }
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
        let toolMsgs = []
        try {
            const parsed = JSON.parse(body)
            toolMsgs = (parsed.messages || []).filter((m) => m.role === 'tool').map((m) => String(m.content || ''))
        } catch { obs.notes.push('body-unparsable') }
        if (toolMsgs.length) {
            obs.toolResults = toolMsgs
            obs.toolRounds++
        }
        flush()
        if (!toolMsgs.length) {
            sse(res, [toolCallFrame('call_w_1', 'probe_write/toolA')])
            console.log(`路径=第1轮 toolCall toolA id=call_w_1`)
            return
        }
        if (obs.toolRounds === 1) {
            sse(res, [toolCallFrame('call_w_1', 'probe_write/toolB')])
            console.log(`路径=第2轮 同id call_w_1 换名 toolB（重放取证位）`)
            return
        }
        sse(res, [chunk({role: 'assistant', content: '写面探针正文：三轮剧本走完。'}, null), chunk({}, 'stop')])
        obs.notes.push(`round3 toolMsgs=${toolMsgs.length}`)
        flush()
        console.log(`路径=第3轮 正文收尾 toolMsgs=${toolMsgs.length}`)
    })
}).listen(PORT, () => {
    console.log(`fake-relay-write listening ${PORT} observe=${OBSERVE || '(none)'}`)
})
