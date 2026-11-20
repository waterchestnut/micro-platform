/**
 * @fileOverview §7-1 澄清冒泡取证用假中继：按 query 标记分流的四段剧本
 * @module evals/platform-probes/fake-relay-clarify
 * @description
 * 配合 `clarify-bubble-e2e-probe.mjs`。请求体按标记分流（query 文本自带路由标）：
 * - 含 `CLARIFY-TREE-CHATA`：无工具结果 ⇒ 先记 tools 声明有没有 request_clarification，
 *   交 toolCall request_clarification(问题+两选项)；带工具结果 ⇒ 交正文 `CHATA-R2-…`
 *   （**不再二次申报**——重跑轮的模型行为本身就是"答复已到"的证据）；
 * - 含 `CLARIFY-TREE-CHATB`：直接交正文；
 * - 含 `CLARIFY-TREE`（synthesis/其他编排内调用）：交综合正文；
 * - 其余：短正文兜底。观测写 --observe。零真 token。
 */
import http from 'node:http'
import fs from 'node:fs'

const argv = process.argv.slice(2)
const val = (n, d) => {
    const hit = argv.find((a) => a.startsWith(`--${n}=`))
    return hit ? hit.slice(n.length + 3) : d
}
const PORT = Number(val('port', 13064))
const OBSERVE = val('observe', '')

const obs = {childAToolDeclared: false, childARounds: 0, paths: []}
const flush = () => { if (OBSERVE) fs.writeFileSync(OBSERVE, JSON.stringify(obs), 'utf8') }

function chunk(delta, finish) {
    return 'data: ' + JSON.stringify({
        id: 'fake', object: 'chat.completion.chunk', created: 1, model: 'fake',
        choices: [{index: 0, delta, finish_reason: finish || null}],
        usage: {prompt_tokens: 5, completion_tokens: 5, total_tokens: 10},
    }) + '\n\n'
}
function sse(res, frames) {
    res.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive'})
    for (const f of frames) res.write(f)
    res.write('data: [DONE]\n\n')
    res.end()
}
function answer(res, text, path) {
    obs.paths.push(path)
    flush()
    sse(res, [chunk({role: 'assistant', content: text}, null), chunk({}, 'stop')])
}

http.createServer((req, res) => {
    if (req.method !== 'POST') { res.writeHead(200, {'Content-Type': 'application/json'}); res.end('{}'); return }
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
        let parsed = null
        try { parsed = JSON.parse(body) } catch { /* 兜底走文本判 */ }
        const toolMsgs = parsed ? (parsed.messages || []).filter((m) => m.role === 'tool') : []
        // planner 非流式分支（M1-c 探针走真受理链）：stream:false ⇒ 交 JSON 契约
        if (body.includes('"stream":false')) {
            obs.paths && obs.paths.push('planner')
            res.writeHead(200, {'Content-Type': 'application/json'})
            res.end(JSON.stringify({
                id: 'fake', object: 'chat.completion', created: 1, model: 'fake',
                choices: [{index: 0, message: {role: 'assistant', content: JSON.stringify({
                    needFanOut: true, reason: '两件事可并行',
                    subtasks: [{title: '甲', query: 'TEV-A 例行工作'}, {title: '乙', query: 'TEV-B 例行工作'}],
                })}, finish_reason: 'stop'}],
                usage: {prompt_tokens: 5, completion_tokens: 5, total_tokens: 10},
            }))
            console.log('路径=planner 非流式 交扇出 JSON')
            return
        }
        if (body.includes('CLARIFY-TREE-CHATA')) {
            // 三分支：首跑开局（无历史无补充）发申报；首跑 ack 轮（有工具结果无补充）交收尾正文；
            // 重跑开局（query 带【澄清补充】，memory off 靠不了历史——标记就是轮次本身）交 R2 正文
            if (!toolMsgs.length && !body.includes('澄清补充')) {
                obs.childARounds++
                if (Array.isArray(parsed?.tools) && parsed.tools.some((t) => t?.function?.name === 'request_clarification')) {
                    obs.childAToolDeclared = true
                }
                flush()
                sse(res, [
                    chunk({role: 'assistant', tool_calls: [{index: 0, id: 'call_cl_1', type: 'function', function: {
                        name: 'request_clarification', arguments: JSON.stringify({question: '部署到哪个环境？', options: ['生产', '预发']})}}]}, 'tool_calls'),
                    chunk({}, 'tool_calls'),
                ])
                console.log('CHATA 首跑 交 request_clarification 申报')
                return
            }
            if (toolMsgs.length && !body.includes('澄清补充')) {
                answer(res, 'CHATA-R1-已申报待澄清，本轮按已知信息收尾。', 'chata-r1')
                console.log('CHATA 首跑 ack 轮 交收尾正文')
                return
            }
            answer(res, 'CHATA-R2-已按答复用生产环境收尾，没有二次申报。', 'chata-r2')
            console.log('CHATA 重跑（带澄清补充）交 R2 正文——不再申报=不二次挂树的直接证据')
            return
        }
        if (body.includes('CLARIFY-TREE-CHATB')) {
            answer(res, 'CHATB-正常完成，无需澄清。', 'chatb')
            return
        }
        if (body.includes('CLARIFY-TREE')) {
            answer(res, 'SYNTH-综合成品：甲按生产环境收尾，乙正常完成。', 'synth')
            return
        }
        answer(res, 'ok', 'fallback')
    })
}).listen(PORT, () => {
    console.log(`fake-relay-clarify listening ${PORT} observe=${OBSERVE || '(none)'}`)
})
