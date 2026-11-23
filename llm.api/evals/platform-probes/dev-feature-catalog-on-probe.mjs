/**
 * @fileOverview P6-dev 功能目录开闸生效探针（配置面 + 装配面 + 检索链 + 账面四段）
 * @module evals/platform-probes/dev-feature-catalog-on-probe
 * @description
 * env 批 02808d4（三容器 enabled=true × channels=["xxzx_common"]）落地后的值班复跑资产。
 * 分层防误读设计（dev-layer-on-probe 同族 + 三次校表教训）：
 *   F1 配置面：runStats featureCatalog 面 enabled/channel——**分三层各报各的**：
 *      auth/网关层（runStats 未返 data 或 code 非 0 ⇒ exit 4，"token 过期/网关坏"与开闸无关）
 *      部署层（应答正常但面缺席 ⇒ exit 2 镜像未到）/ 开关层（面在但 enabled=false ⇒ exit 2 env 未铺）
 *   F2 装配面：真会话 SSE 读 /core/chat/stream——meta 帧 tools 数组含 platform_features
 *      =装配开闸实锤。**探针第三次校表教训**：本接口返 SSE（text/event-stream），
 *      旧版 `res.json()` 把证据吞成"未获受理"假阴性——响应形态必须实测，不许照抄先例假设
 *   F3 检索链+账面：tool_result 帧的 matched（模型真调了检索）+ featureCallLog 按探针
 *      conversationCode 读回（dev pod 写的真账，decision/denyReason/status 逐项打印）。
 *      F2 过而 F3 无 = 开关到了模型没调，合法终态不判红（不赌模型意愿）。
 * 账行只追加不清理（真实审计面，探针不造作废账）。
 * 实测（2026-11-23 首跑全真）：F1 enabled=true/xxzx_common；F2 tools 含 platform_features；
 * F3 matched 3 条（callin-stat/learoad-stat/raisef-stat，effectClass=read）+ 账面行在。
 * 跑法：node evals/platform-probes/dev-feature-catalog-on-probe.mjs
 */
import fs from 'node:fs'
await import('../../init.js')
const { FeatureCallLog } = await import('../../daos/core/schema/index.js')
const token = fs.readFileSync('C:/Users/menglb/AppData/Local/Temp/opencode/dev-token.txt', 'utf8').trim()
const GW = 'https://api.xxzx.paretop.net/llm'
const USER = Buffer.from(JSON.stringify({ userCode: 'menglb', realName: 'P6开闸实测' })).toString('base64')
const H = { 'content-type': 'application/json', 'user-info': USER, 'param-accessToken': token }
const V = {}
const out = {}
const TS = Date.now()
const CONV = `p6fcprobe-${TS}`
try {
    // ===== F1 配置面（三层分诊）=====
    const rs = await fetch(GW + '/core/chat/runStats', { method: 'POST', headers: H, body: '{}', signal: AbortSignal.timeout(30000) })
    const j = await rs.json().catch(() => null) || {}
    if (j.data == null || (j.code != null && j.code !== 0 && j.code !== 200)) {
        out.F1_layer = 'auth/gateway'
        out.F1 = { status: rs.status, code: j.code, msg: String(j.msg || '').slice(0, 80) }
        out.note = 'runStats 未返数据（token 过期/网关故障）——非本功能开闸问题，鉴权修复后再跑'
        out.verdict = V; out.结论 = `auth 层失败(code=${j.code} msg=${String(j.msg || '').slice(0, 40)})：exit 4 语义，与功能目录开闸无关`
        console.log(JSON.stringify(out, null, 1)); process.exit(4)
    }
    const fc = j.data.featureCatalog ?? null
    out.F1 = fc
    V.F1 = !!(fc && fc.enabled === true && (fc.enabledChannels || []).includes('xxzx_common'))
    if (!V.F1) {
        out.F1_layer = fc == null ? 'deploy(镜像未到)' : 'switch(env 未铺/漂移)'
        out.note = fc == null
            ? 'runStats 正常应答但 featureCatalog 面缺席 ⇒ 镜像未到（核母本 push 触发的构建是否滚完），不测行为面'
            : `featureCatalog 面在但 enabled=${fc.enabled} channels=${JSON.stringify(fc.enabledChannels)} ⇒ env 未到 pod/配置漂移，核 jenkins yaml，不测行为面`
        out.verdict = V; out.结论 = '等待部署/配置：exit 2 语义（' + out.F1_layer + '）'
        console.log(JSON.stringify(out, null, 1)); process.exit(2)
    }
    // ===== F2 装配面 + F3 检索链（真会话 SSE）=====
    const q = '请用 platform_features 工具检索平台功能目录（关键词"统计"），列出检索到的功能条目名称和各自的用途，不要凭空介绍。'
    const sres = await fetch(GW + '/core/chat/stream', {
        method: 'POST', headers: H,
        body: JSON.stringify({ query: q, conversationCode: CONV, options: { channel: 'xxzx_common', protocol: 2, cache: false, messageCode: crypto.randomUUID() } }),
        signal: AbortSignal.timeout(240000),
    })
    const ct = sres.headers.get('content-type') || ''
    if (!ct.includes('event-stream')) {
        const t = await sres.text()
        out.F2 = { ct, body: t.slice(0, 200) }
        throw new Error('stream 非 SSE 响应（信封见 F2），人工分诊')
    }
    const txt = await sres.text()   // 流跑到收口才返回（同步会话）
    let metaTools = null, matched = null, events = {}
    for (const line of txt.split('\n')) {
        if (!line.startsWith('data:')) continue
        let d = null
        try { d = JSON.parse(line.slice(5)) } catch { continue }
        if (d.type === 'meta') metaTools = d.tools || []
        if (d.role === 'tool' && String(d.content || '').includes('"matched"')) {
            try { matched = JSON.parse(d.content) } catch { }
        }
        events[d.type || d.role || 'other'] = (events[d.type || d.role || 'other'] || 0) + 1
    }
    out.F2 = { toolsHasPlatformFeatures: !!(metaTools && metaTools.includes('platform_features')), toolCount: metaTools ? metaTools.length : null, events }
    V.F2 = !!(metaTools && metaTools.includes('platform_features'))   // 装配面=开闸核心判据
    out.F3 = { matchedCount: matched ? (matched.matched || []).length : null, entries: matched ? (matched.matched || []).map((m) => `${m.skillCode}/${m.effectClass}`) : null }
    V.F3 = !!(matched && (matched.matched || []).length > 0)
    // ===== 账面：featureCallLog 按探针 conv 读回 =====
    await new Promise((r) => setTimeout(r, 5000))
    const rows = await FeatureCallLog.find({ conversationCode: CONV }).sort({ insertTime: 1 }).lean()
    out.账面 = rows.map((r) => ({ kind: r.kind, decision: r.decision, denyReason: r.denyReason, status: r.status, keyword: r.keyword, matched: r.matchedCount, visible: r.visibleCount }))
    if (rows.length) {
        V.L = true
        const s = rows.find((r) => r.kind === 'search')
        out.判读 = s
            ? (s.status === 'permission-service-unavailable' ? 'V7 降级腿（ucenter 不可达）——真链实走非代码问题'
                : (s.visibleCount > 0 ? 'allow 面转实：两层判据在 dev 真环境放行且有账' : `有账但 visible=0（decision=${s.decision}）——browse 点或 priv 脸色，如实入册`))
            : '非 search 类事件入账（如实打印）'
    } else {
        V.L = null
        out.判读 = 'F2 过而账面零行=装配在位、审计未落（异常，人工核 auditSink）'
    }
    out.verdict = V
    out.结论 = V.F2
        ? (V.F3 && V.L ? `P6-dev 开闸全真：配置面+装配面+检索链(${out.F3.matchedCount} 条命中)+账面(${rows.length} 行)`
            : 'P6-dev 装配面生效（tools 含 platform_features）；检索链/账面读数见上')
        : 'F1 过而 F2 装配面未过——检查 executor/http 镜像与频道（读数见上）'
} catch (e) {
    out.error = String(e?.message || e).slice(0, 300)
    out.verdict = V
    out.结论 = '执行异常，读数见上'
}
console.log(JSON.stringify(out, null, 1))
process.exit(V.F1 && V.F2 ? 0 : 1)
