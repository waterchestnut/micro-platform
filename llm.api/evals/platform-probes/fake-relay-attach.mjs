/**
 * @fileOverview B-1 附件前门取证用假中继：按会话标记分双剧本（正例三轮 / 对照组一轮）
 * @module evals/platform-probes/fake-relay-attach
 * @description
 * 配合 `task-attachment-e2e-probe.mjs`。同一 relay 进程服务两次 run（env 只能配一个 relay base）：
 * 请求体含 `CTRLRUN`（探针放进对照组 query）⇒ plain：只记 tools 声明观察，交正文；
 * 否则正例剧本：
 * 1. 无工具结果 ⇒ 记 tools 有无 read_attachment（**声明面精确判读**，历史回显不算），交
 *    toolCall read_attachment(fc-probe-ok)；
 * 2. 带 1 份工具结果 ⇒ 交 toolCall read_attachment(fc-forbidden)——红线试探，期望运行侧根本不碰 doc.api；
 * 3. 带 2 份工具结果 ⇒ 交正文收尾。
 * 观测写 --observe 文件，探针读它 + 读假 doc.api 的 hits，两边对齐才算通过。零真 token。
 */
import http from 'node:http'
import fs from 'node:fs'

const argv = process.argv.slice(2)
const val = (n, d) => {
    const hit = argv.find((a) => a.startsWith(`--${n}=`))
    return hit ? hit.slice(n.length + 3) : d
}
const PORT = Number(val('port', 13062))
const OBSERVE = val('observe', '')

const obs = {
    run1: {hits: 0, sawTool: false, toolRounds: 0, toolResults: []},
    run2: {hits: 0, sawTool: false, answered: false},
    notes: [],
}
const flush = () => { if (OBSERVE) fs.writeFileSync(OBSERVE, JSON.stringify(obs), 'utf8') }

function chunk(delta, finish) {
    return 'data: ' + JSON.stringify({
        id: 'fake', object: 'chat.completion.chunk', created: 1, model: 'fake',
        choices: [{index: 0, delta, finish_reason: finish || null}],
        usage: {prompt_tokens: 5, completion_tokens: 5, total_tokens: 10},
    }) + '\n\n'
}
function toolCallFrame(id, fileCode) {
    return chunk({role: 'assistant', tool_calls: [{index: 0, id, type: 'function',
        function: {name: 'read_attachment', arguments: JSON.stringify({fileCode})}}]}, 'tool_calls')
}
function sse(res, frames) {
    res.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive'})
    for (const f of frames) res.write(f)
    res.write('data: [DONE]\n\n')
    res.end()
}

http.createServer((req, res) => {
    if (req.method !== 'POST') { res.writeHead(200, {'Content-Type': 'application/json'}); res.end('{}'); return }
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
        let parsed = null
        try { parsed = JSON.parse(body) } catch { obs.notes.push('unparsable') }
        const toolMsgs = parsed ? (parsed.messages || []).filter((m) => m.role === 'tool').map((m) => String(m.content || '')) : []
        // tools 声明面精确判读：只有注册面会把 read_attachment 放进 tools；历史回显不算
        const sawTool = !!(parsed && Array.isArray(parsed.tools) && parsed.tools.some((t) => t?.function?.name === 'read_attachment'))
        if (body.includes('CTRLRUN')) {
            obs.run2.hits++
            obs.run2.sawTool = obs.run2.sawTool || sawTool
            obs.run2.answered = true
            flush()
            sse(res, [chunk({role: 'assistant', content: '对照组正文：注册面不该有这个工具。'}, null), chunk({}, 'stop')])
            console.log(`run2(对照) hits=${obs.run2.hits} sawTool=${obs.run2.sawTool}`)
            return
        }
        const r = obs.run1
        r.hits++
        r.sawTool = r.sawTool || sawTool
        if (toolMsgs.length) { r.toolResults = toolMsgs; r.toolRounds++ }
        flush()
        if (r.toolRounds === 0) {
            sse(res, [toolCallFrame('call_att_1', 'fc-probe-ok')])
            console.log(`run1 第1轮 交 read_attachment(fc-probe-ok) sawTool=${r.sawTool}`)
            return
        }
        if (r.toolRounds === 1) {
            sse(res, [toolCallFrame('call_att_2', 'fc-forbidden')])
            console.log('run1 第2轮 交 read_attachment(fc-forbidden) 红线试探')
            return
        }
        sse(res, [chunk({role: 'assistant', content: '附件读回探针正文。'}, null), chunk({}, 'stop')])
        console.log('run1 第3轮 交正文收尾')
    })
}).listen(PORT, () => {
    console.log(`fake-relay-attach listening ${PORT} observe=${OBSERVE || '(none)'}`)
})
