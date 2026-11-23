/**
 * @fileOverview P6-dev 功能目录开闸生效探针（部署面 + 行为面 + 账面三段）
 * @module evals/platform-probes/dev-feature-catalog-on-probe
 * @description
 * env 批 02808d4（三容器 enabled=true × channels=["xxzx_common"]）落地后的值班复跑资产。
 * 三段防误读设计（dev-layer-on-probe 同族）：
 *   F1 runStats featureCatalog 面：enabled=true 且 xxzx_common 在 enabledChannels——
 *      不过直接 exit 2（"env 没铺到"与"行为没发生"必须分开报，绝不把前者记成后者）
 *   F2 taskMode 受理成树并轮询收口（请求句式显式要求功能目录检索，提高模型调用意愿，
 *      但不赌它——F3 无账时如实报"开关到了模型没调"）
 *   F3 featureCallLog 按探针专属 conversationCode 读回（dev pod 写的账，本机同栈直连）：
 *      有行 ⇒ decision/denyReason/status 逐项打印（两层判据在真环境的脸色：menglb 有没有
 *      xxzx-browse、ucenter 可达否）；零行但 F1 过 ⇒ exit 0 如实登记，不判红
 * 账行只追加不清理（真实审计面，探针不造作废账）。
 * 跑法：node evals/platform-probes/dev-feature-catalog-on-probe.mjs
 */
import fs from 'node:fs'
await import('../../init.js')
const { FeatureCallLog } = await import('../../daos/core/schema/index.js')
const token = fs.readFileSync('C:/Users/menglb/AppData/Local/Temp/opencode/dev-token.txt', 'utf8').trim()
const GW = 'https://api.xxzx.paretop.net/llm'
const USER = Buffer.from(JSON.stringify({ userCode: 'menglb', realName: 'P6开闸实测' })).toString('base64')
const H = { 'content-type': 'application/json', 'user-info': USER, 'param-accessToken': token }
const post = async (path, body, ms = 90000) => {
    const res = await fetch(GW + path, { method: 'POST', headers: H, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) })
    return { status: res.status, j: await res.json().catch(() => null) }
}
const V = {}
const out = {}
const TS = Date.now()
const CONV = `p6fcprobe-${TS}`
try {
    // F1 部署面——分层分诊（§17 探针校表教训：auth 层/部署层/开关层各报各的，
    // "token 无效"绝不能被吞成"开关没生效"——P6 首跑 10 轮空等的现形）
    const rs = await post('/core/chat/runStats', {}, 30000)
    const j = rs.j || {}
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
    // F2 行为面：显式要求目录检索的题（意愿提升，不赌调用）
    const q = '请用 platform_features 工具检索平台功能目录（关键词"统计"），列出检索到的功能条目名称和各自的用途，不要凭空介绍。'
    const a = await post('/core/chat/stream', {
        query: q, conversationCode: CONV,
        options: { channel: 'xxzx_common', protocol: 2, cache: false, messageCode: crypto.randomUUID(), taskMode: true },
    })
    out.受理 = { status: a.status, code: a.j?.code, data: JSON.stringify(a.j?.data || {}).slice(0, 160) }
    const rootCode = a.j?.data?.rootCode || ''
    V.F2 = !!rootCode
    if (!rootCode) throw new Error('未获受理（信封见上）')
    let ph = ''
    for (let i = 0; i < 14; i++) {
        await new Promise((r) => setTimeout(r, 15000))
        const d = await post('/core/agentTask/detail', { agentCode: rootCode }, 30000)
        ph = d.j?.data?.phase || ''
        out.phase = ph
        if (['synthesized', 'partial', 'failed'].includes(ph)) {
            out.finalAnswer = String(d.j?.data?.finalAnswer || d.j?.data?.answer || '').slice(0, 220)
            break
        }
    }
    // F3 账面：探针专属 conversationCode 读回（dev pod 写的真账）
    await new Promise((r) => setTimeout(r, 5000))
    const rows = await FeatureCallLog.find({ conversationCode: CONV }).sort({ insertTime: 1 }).lean()
    out.账面 = rows.map((r) => ({ kind: r.kind, decision: r.decision, denyReason: r.denyReason, status: r.status, keyword: r.keyword, matched: r.matchedCount, visible: r.visibleCount, feature: r.featureCode }))
    if (rows.length) {
        V.F3 = true
        const s = rows.find((r) => r.kind === 'search')
        out.判读 = s
            ? (s.status === 'permission-service-unavailable' ? 'V7 降级腿（ucenter 不可达）——真链实走非代码问题'
                : (s.visibleCount > 0 ? 'allow 面转实：两层判据在 dev 真环境放行且有账' : `有账但 visible=0（decision=${s.decision}）——browse 点或 priv 脸色，如实入册`))
            : '非 search 类事件入账（如实打印）'
    } else {
        V.F3 = null   // 不是失败：开关到位、模型本次没调，是合法终态
        out.判读 = 'F1 过而账面零行=开关到了、模型这次没调（不判红，可换题复跑）'
    }
    out.verdict = V
    out.结论 = V.F1 && V.F2 ? (V.F3 === true ? `P6-dev 开闸生效：装配+行为+账面三段真链（${rows.length} 行账）` : 'P6-dev 开关生效，行为面未触发（登记复跑）') : '见分诊'
} catch (e) {
    out.error = String(e?.message || e).slice(0, 300)
    out.verdict = V
    out.结论 = '执行异常，读数见上'
}
console.log(JSON.stringify(out, null, 1))
process.exit(V.F1 && V.F2 ? 0 : 1)
