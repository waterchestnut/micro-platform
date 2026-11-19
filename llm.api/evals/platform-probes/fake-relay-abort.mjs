/**
 * @fileOverview 假中继：确定性地造出"客户端在 await 上游调用时断开"，且不消耗真实 token
 * @module evals/platform-probes/fake-relay-abort
 * @description
 * 配合 `interrupt-attribution-probe.mjs` 使用。为什么需要它（都是实测出来的）：
 * - 真实上游的"流中途断开"会被 PR-E0.5 在 `drainAssistantStream` 里加的停判据礼貌接走，
 *   落库走 `loop-exit` 而不是错误路径，服务端日志里连 `主循环异常` 都没有；
 * - 遗留那 2 行 `unspecified` 的签名是 `writtenBy:'error'` + `abort:Request was aborted.`
 *   + `iterationCount/modelCalls = 2/2` ⇒ 只有"**第二轮的 await** 期间连接消失"才进得了
 *   `PERSIST_VIA.ERROR`。
 * 所以这里把第一次请求答成一个只读工具调用（`memory_search`，不碰外部服务），
 * 把第二次请求的首字节压到 `--delay` 之后 ⇒ 客户端在 delay/2 处硬断，服务端必然卡在第二次 await。
 *
 * 用法（另起一台服务把 relay 指过来，`src/` 下）：
 *   node evals/platform-probes/fake-relay-abort.mjs --port=13011 --delay=6000 --rounds=2
 *   $env:PORT=12012; $env:LLM_RELAY_BASE_URL='http://127.0.0.1:13011/v1'; node server.js
 *   $env:FAKE='1'; $env:PROBE_BASE='http://127.0.0.1:12012'; node evals/platform-probes/interrupt-attribution-probe.mjs --mode=await --waitMs=2500
 *
 * 期望形状（2026-11-12 实测）：`writtenBy:'error'`、`loopExit:'aborted:error'`、
 * `errorKind:'abort'`、`interruptedBy:'client-disconnect'`。
 * `--rounds=1` 是单轮延迟版（用来验"第一次 await 就断"，实测会落 `loop-exit`，不是错误路径）。
 */
import http from 'node:http'

const argv = process.argv.slice(2)
/**
 * @description 取命令行参数
 * @param {String} n 参数名（不含 --）
 * @param {String} def 缺省值
 * @returns {String} 结果
 */
function val(n, def) {
    const hit = argv.find((a) => a.startsWith(`--${n}=`))
    return hit ? hit.slice(n.length + 3) : def
}
const PORT = Number(val('port', 13011))
const DELAY = Number(val('delay', 6000))
const ROUNDS = Number(val('rounds', 2))
/**
 * `--argsChars=N`：让第一轮的工具**入参**长度约为 N（用 `query` 字段填充）。
 * 存在的理由很具体：`argsTruncated` 这条分支在真实流量里我一次都没测到过
 * （`limits.toolArgsChars=4000`，而 `h1-args-probe.mjs` 的注释已经写明"固定一句话永远测不出长入参"，
 * 让模型自己写 4000 字符以上的代码参数并不可靠）。
 * 把它做成可控输入，才能证明"入参被截断"这件事在服务端真的会写出来、且写的是真实长度。
 */
const ARGS_CHARS = Number(val('argsChars', 0))
/**
 * `--finalizeDelay=MS`：**收尾（无工具补落）调用**的首字节延迟。
 * 认它的办法是看请求体里有没有 `tools`——收尾调用的 body 不挂工具。
 * 有的意义很具体：`finalize-interrupted` 这个落库点要求"打断发生在收尾调用里"，
 * 没有可控的收尾延迟，就永远只能靠真实上游的时序碰运气（dev 至今 0 样本）。
 */
const FINALIZE_DELAY = Number(val('finalizeDelay', 0))
/**
 * `--stallRound=K`：第 K 次请求**永不返回内容**（连接挂着）。
 * 存在的理由：`PERSIST_VIA.RESCUE` 的条件是"停机已经开始、而 run 在 1 秒的归档等待里还没走到落库点"，
 * 上游正常返回时 close-with-grace 会把 run 等完 ⇒ 永远落成 `finish`，rescue 这条路根本不会被走到。
 * 只有让上游卡住，才能把"抢救兜底"变成可复现事件（而不是等一次真实发版碰运气）。
 */
const STALL_ROUND = Number(val('stallRound', 0))
/**
 * `--failFirst=N`：**本进程的前 N 次请求**在首字节前直接回 503。
 * 存在的理由：dev 真实流量里"`modelCalls ≠ iterationCount`"的行全部来自**SDK 层重试**
 * （实测 7 行 `iter=1/calls=3`；判"应用层重试关着"要看配置面 `upstreamRetry_enabled`，
 *  **不能拿 `extInfo.upstream` 为空当证据**——该键在 `b397822` 之前从不落库（落库白名单漏了它），
 *  历史行的"空"是"没写"而非"重试没发生"，缺键推不出任何重试状态——同 abort-archive 的版本边界教训：
 *  用今天的代码/今天的字段存在性去解释昨天的数据，会把仪器盲区读成被测事实。
 *  而 `maxRetries` 未显式设置时 SDK 自己会重发）。要复现"有工具 + 两者不等"这一形状，
 * 就得能按剧本让上游先失败一次，而不是等真实现网抖动。
 * **按进程计数**：换一发实验请重启中继（`--stallRound` 当年就栽在进程计数上，这里把它写进判据说明）。
 */
const FAIL_FIRST = Number(val('failFirst', 0))
const FINALIZE_TAIL_MS = Number(val('finalizeTailMs', 0))
let hits = 0

/**
 * @description 拼一条 OpenAI 流式 chunk
 * @param {Object} delta delta 对象
 * @param {String} finish finish_reason
 * @returns {String} SSE 帧
 */
function chunk(delta, finish) {
    return 'data: ' + JSON.stringify({
        id: 'fake', object: 'chat.completion.chunk', created: 1, model: 'fake',
        choices: [{index: 0, delta, finish_reason: finish || null}],
        usage: {prompt_tokens: 5, completion_tokens: 5, total_tokens: 10},
    }) + '\n\n'
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
        hits++
        /**
         * 轮次必须由**请求内容**决定，不能用进程命中数：
         * 命中数会让同一个进程只能服务"第一次实验"，第二次请求就被当成第二轮，
         * 于是探针看似跑了、其实根本没走工具分支（实测栽过一次）。
         * 判据：历史里还没有 role:'tool' 的 ⇒ 第一次调用，交回工具调用；已有 ⇒ 交回正文。
         */
        const hasToolResult = /"role"\s*:\s*"tool"/.test(body)
        const isToolRound = ROUNDS >= 2 && !hasToolResult
        /**
         * 收尾（无工具补落）调用的特征：请求体里没有 `tools`。
         * `--finalizeDelay` 只延迟这一种请求，用来把"打断发生在收尾调用里"变成可控事件。
         */
        const isFinalizeCall = FINALIZE_DELAY > 0 && !/"tools"/.test(body)
        const waitMs = isFinalizeCall ? FINALIZE_DELAY : DELAY
        console.log(`hit=${hits} round=${ROUNDS} 路径=${req.url} 入参字节=${body.length} 已有工具结果=${hasToolResult} 本轮交工具=${isToolRound} 是收尾调用=${isFinalizeCall} 本轮延迟ms=${waitMs}`)
        if (FAIL_FIRST > 0 && hits <= FAIL_FIRST) {
            /** 首字节前失败：SDK 的重试层（`maxRetries` 未显式设置时为 2）会照常规重发一次 */
            res.writeHead(503, {'Content-Type': 'application/json'})
            res.end(JSON.stringify({error: {message: 'fake relay: 首字节前失败', type: 'server_error'}}))
            console.log(`fail503 hit=${hits} 计划失败前${FAIL_FIRST}次`)
            return
        }
        /**
         * 卡住哪一轮也按**请求内容**判定，不用进程计数：
         * `--stallRound>0` 的含义是"**工具结果之后的那一轮**（也就是第二轮上游调用）永不应答"。
         * 用 hits 计数会在同一个中继进程的第二发实验上静默失效——这个坑我今天已经栽过一次。
         */
        const isStall = STALL_ROUND > 0 && hasToolResult
        if (isStall) {
            /** 挂着不答：只写响应头，永远不发帧（探针侧靠 app.close() 触发停机归档等待） */
            res.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive'})
            res.write(': stalled\n\n')
            console.log(`stalled hit=${hits}（工具结果之后的那一轮永不应答，用来把 rescue 路径变成可复现事件）`)
            return
        }
        if (!isToolRound && body.indexOf('"stream":false') >= 0) {
            /** 非流式调用（收尾判定之类）：给个空壳，别让服务端在别处卡住 */
            res.writeHead(200, {'Content-Type': 'application/json'})
            res.end(JSON.stringify({id: 'fake', object: 'chat.completion', choices: [{index: 0, message: {role: 'assistant', content: ''}, finish_reason: 'stop'}], usage: {prompt_tokens: 1, completion_tokens: 1, total_tokens: 2}}))
            return
        }
        res.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive'})
        if (isToolRound) {
            /**
             * `--stallRound` 时先交回一段正文再交回 tool_calls：
             * 没有正文的话 rescue **按设计不该写档**（写 0 字 abort 会挡住随后真正的 finish，
             * 这是 v1.41 的读数逼出来的规则），所以要让这条路径可复现，必须先有内容。
             */
            if (STALL_ROUND > 0) {
                res.write(chunk({role: 'assistant', content: '先给你一段已经生成的正文。'}, null))
            }
            /**
             * 入参长度可控：填充到 ARGS_CHARS（≥ 上限 4000 时必然触发截断分支）；
             * 没给就保持原来那句短查询（归因实验用的就是它）。
             */
            const pad = ARGS_CHARS > 0 ? 'x'.repeat(Math.max(0, ARGS_CHARS - 24)) : '过程可见性'
            const args = JSON.stringify({query: pad})
            res.write(chunk({role: 'assistant', tool_calls: [{index: 0, id: 'call_mem_1', type: 'function', function: {name: 'memory_search', arguments: args}}]}, null))
            res.write(chunk({}, 'tool_calls'))
            res.write('data: [DONE]\n\n')
            res.end()
            console.log(`tool_round argsBytes=${args.length} 目标=${ARGS_CHARS}`)
            return
        }
        const t = setTimeout(() => {
            res.write(chunk({content: '假中继的第二轮正文。'}, null))
            if (isFinalizeCall && FINALIZE_TAIL_MS > 0) {
                /**
                 * 收尾调用"分两段送"：第一段先出，`FINALIZE_TAIL_MS` 后再出第二段。
                 * 用途很具体：`stopped` 只在**每帧之前**被检查，所以必须让有一帧落在
                 * "停止位已置起"之后到达，`finalize-interrupted` 才有机会被走到
                 * （2026-11-13 用纯 abort 复现失败后读代码定下的做法）。
                 */
                setTimeout(() => {
                    res.write(chunk({content: '（停止位之后的第二段）'}, null))
                    res.write(chunk({}, 'stop'))
                    res.write('data: [DONE]\n\n')
                    res.end()
                }, FINALIZE_TAIL_MS)
                return
            }
            res.write(chunk({}, 'stop'))
            res.write('data: [DONE]\n\n')
            res.end()
        }, waitMs)
        req.socket.on('close', () => clearTimeout(t))
    })
}).listen(PORT, '127.0.0.1', () => {
    console.log(`fake-relay-abort 127.0.0.1:${PORT} rounds=${ROUNDS} 延迟=${DELAY}ms`)
})
