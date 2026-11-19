/**
 * @fileOverview PR-M 端到端取证用的假中继：按剧本走 update_plan → 正文 → 完成性反问
 * @module evals/platform-probes/fake-relay-plan
 * @description
 * 配合 `plan-e2e-probe.mjs`。目的只有一个：**把"接线是否真的在主循环里发生"变成可观察事件**——
 * 单测与源码级接线守卫能证明"函数对、调用点在"，证明不了"开起来后 execChat 真的按这个顺序走了一遍"。
 * 全程假中继、零真实 token，不落生产租户。
 *
 * 轮次一律由**请求内容**判定（`fake-relay-abort` 用进程命中数栽过，这里不重犯）：
 * - 请求里有 `role:'tool'` 结果 ⇒ 是 update_plan 之后的那一轮 ⇒ ①记录"这次发送副本里有没有 recitation（计划状态）"，②交回正文；
 * - 有 `"tools"` 且没有工具结果 ⇒ 第一轮 ⇒ 交回一个 `update_plan` 工具调用（items 留一项 pending，供完成性反问触发）；
 * - 没有 `"tools"`（`buildFinalizeBody` 会摘掉 tools）⇒ 这就是**完成性反问调用** ⇒ 记录它发生了，交回 `CONTINUE\n…补充…`。
 * 观测结果写进 `--observe=路径` 的 JSON，探针读它 + 读档案，两边对齐才算通过。
 *
 * 用法（另起服务把 relay 指过来，`src/` 下）：
 *   node evals/platform-probes/fake-relay-plan.mjs --port=13031 --observe=/tmp/planobs.json
 *   $env:PORT=12031; $env:LLM_RELAY_BASE_URL='http://127.0.0.1:13031/v1'; $env:plan_enabled='true'; $env:finalize_selfCheck='true'; node server.js
 *   $env:PROBE_BASE='http://127.0.0.1:12031'; node evals/platform-probes/plan-e2e-probe.mjs --observe=/tmp/planobs.json
 */
import http from 'node:http'
import fs from 'node:fs'

const argv = process.argv.slice(2)
const val = (n, d) => {
    const hit = argv.find((a) => a.startsWith(`--${n}=`))
    return hit ? hit.slice(n.length + 3) : d
}
const PORT = Number(val('port', 13031))
const OBSERVE = val('observe', '')

/** 跨请求累计的观测（不靠命中数判定，只记账给探针看） */
const obs = {recitationInSendCopy: false, selfCallCheckHappened: false, updatePlanToolCallSent: false, answerTurnSent: false, hits: 0, notes: []}
function flush() {
    if (OBSERVE) {
        fs.writeFileSync(OBSERVE, JSON.stringify(obs), 'utf8')
    }
}

function chunk(delta, finish) {
    return 'data: ' + JSON.stringify({
        id: 'fake', object: 'chat.completion.chunk', created: 1, model: 'fake',
        choices: [{index: 0, delta, finish_reason: finish || null}],
        usage: {prompt_tokens: 5, completion_tokens: 5, total_tokens: 10},
    }) + '\n\n'
}

function sse(res, frames) {
    res.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive'})
    for (const f of frames) {
        res.write(f)
    }
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
    req.on('data', (c) => {
        body += c
    })
    req.on('end', () => {
        obs.hits++
        const hasToolResult = /"role"\s*:\s*"tool"/.test(body)
        const hasTools = /"tools"/.test(body)
        const recitation = /计划状态·系统重述|计划状态/.test(body)
        if (recitation) {
            obs.recitationInSendCopy = true
            obs.notes.push('send copy contained recitation marker')
        }
        flush()
        // 完成性反问：buildFinalizeBody 摘掉了 tools ⇒ 无 tools 的流式调用。它可能排在正文之后，
        // 也可能（异常路径）在别处；这里以"无 tools 且 stream"为特征。
        if (!hasTools && body.indexOf('"stream":true') >= 0) {
            obs.selfCallCheckHappened = true
            flush()
            sse(res, [chunk({role: 'assistant', content: 'CONTINUE\n补充：我确实漏了步骤B，现已补完并核验。'}, null), chunk({}, 'stop')])
            console.log(`hit=${obs.hits} 路径=self-check 交回 CONTINUE 补充`)
            return
        }
        if (!hasTools && body.indexOf('"stream":false') >= 0) {
            res.writeHead(200, {'Content-Type': 'application/json'})
            res.end(JSON.stringify({id: 'fake', object: 'chat.completion', choices: [{index: 0, message: {role: 'assistant', content: ''}, finish_reason: 'stop'}], usage: {prompt_tokens: 1, completion_tokens: 1, total_tokens: 2}}))
            return
        }
        if (hasToolResult) {
            // update_plan 之后的那一轮：交回正文，让循环以 break 收尾（有计划且有正文 ⇒ 触发完成性反问）
            obs.answerTurnSent = true
            flush()
            sse(res, [chunk({role: 'assistant', content: '这是基于计划的最终回答。'}, null), chunk({}, 'stop')])
            console.log(`hit=${obs.hits} 路径=answer(有工具结果) recitation=${recitation}`)
            return
        }
        // 第一轮：交回 update_plan 工具调用（留一项 pending，专门用来触发完成性反问）
        const args = JSON.stringify({items: [{id: 's1', title: '步骤A：取数', status: 'done'}, {id: 's2', title: '步骤B：写结论', status: 'pending'}]})
        obs.updatePlanToolCallSent = true
        flush()
        sse(res, [
            chunk({role: 'assistant', tool_calls: [{index: 0, id: 'call_plan_1', type: 'function', function: {name: 'update_plan', arguments: args}}]}, null),
            chunk({}, 'tool_calls'),
        ])
        console.log(`hit=${obs.hits} 路径=update_plan argsBytes=${args.length}`)
    })
}).listen(PORT, () => {
    console.log(`fake-relay-plan listening ${PORT} observe=${OBSERVE || '(none)'}`)
})
