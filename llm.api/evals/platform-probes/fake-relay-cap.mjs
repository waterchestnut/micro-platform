/**
 * @fileOverview P-8 压测用假中继：planner 契约 + 定速帧流剧本（零真 token）
 * @module evals/platform-probes/fake-relay-cap
 * @description
 * 配合 `cap-probe-p8.mjs`。三分支：
 * - `"stream":false` ⇒ planner JSON（扇出契约，S2 用）；
 * - 含 `CAP-SUB` ⇒ child 剧本：先慢流 F 帧（每帧 ~60B、间隔 paceMs），再 stop
 *   ——同时把聊天帧镜像与任务事件镜像都压起来；
 * - 其余 ⇒ 纯聊天慢流（S1 用）。
 * 帧数与间隔由 --frames/--pace 参数（默认 150×40ms≈6s/run）。
 */
import http from 'node:http'

const argv = process.argv.slice(2)
const val = (n, d) => {
    const hit = argv.find((a) => a.startsWith(`--${n}=`))
    return hit ? hit.slice(n.length + 3) : d
}
const PORT = Number(val('port', 13070))
const FRAMES = Number(val('frames', 150))
const PACE = Number(val('pace', 40))

let live = 0
const chunk = (delta, finish) => 'data: ' + JSON.stringify({
    id: 'fake', object: 'chat.completion.chunk', created: 1, model: 'fake',
    choices: [{index: 0, delta, finish_reason: finish || null}],
    usage: {prompt_tokens: 5, completion_tokens: 5, total_tokens: 10},
}) + '\n\n'

http.createServer((req, res) => {
    if (req.method !== 'POST') { res.writeHead(200, {'content-type': 'application/json'}); res.end('{}'); return }
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
        if (body.includes('"stream":false')) {
            res.writeHead(200, {'content-type': 'application/json'})
            res.end(JSON.stringify({
                id: 'fake', object: 'chat.completion', created: 1, model: 'fake',
                choices: [{index: 0, message: {role: 'assistant', content: JSON.stringify({
                    needFanOut: true, reason: '压测两任务',
                    subtasks: [{title: '压甲', query: 'CAP-SUB-A 压测子任务'}, {title: '压乙', query: 'CAP-SUB-B 压测子任务'}],
                })}, finish_reason: 'stop'}],
                usage: {prompt_tokens: 5, completion_tokens: 5, total_tokens: 10},
            }))
            return
        }
        live++
        res.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive'})
        const isSub = body.includes('CAP-SUB')
        let i = 0
        const tick = setInterval(() => {
            if (i < FRAMES) {
                res.write(chunk({content: `帧${String(i).padStart(4, '0')}填充填充填充填充`}, null))
                i++
                return
            }
            clearInterval(tick)
            if (isSub) {
                res.write(chunk({content: '压测子任务正文收尾。'}, null))
                res.write(chunk({}, 'stop'))
            } else {
                res.write(chunk({}, 'stop'))
            }
            res.write('data: [DONE]\n\n')
            res.end()
            live--
        }, PACE)
    })
}).listen(PORT, () => {
    console.log(`fake-relay-cap listening ${PORT} frames=${FRAMES} pace=${PACE}ms`)
})
