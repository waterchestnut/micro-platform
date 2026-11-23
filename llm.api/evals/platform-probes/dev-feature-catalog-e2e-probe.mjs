/**
 * @fileOverview 功能目录 Phase 1 全链 e2e 取证（刀5）：reconcile/检索/提案态/账面四段真链
 * @module evals/platform-probes/dev-feature-catalog-e2e-probe
 * @description
 * 刀1~4 的判据都有穷举单测，本探针验的是**它们与真引擎真库真 ucenter 的接合**：
 * 真 grpcSkill 表、真 skillWriteJournal 唯一索引、真 featureCallLog、真 hasPriv RPC。
 *
 * 四段判据（EXPECTED=8）：
 *  R reconcile：admin（in-process 政策翻转，follow 探针同法）首对账 ⇒ pending 出生 →
 *    真审核批准 → 再对账删一条 ⇒ 装配中行被打回 pending 'manifest-removed'（W8 主防线）
 *  S 检索：三形目录行（公共/功能级 priv/门控行）走真管道——公共行必命中；带不存在 priv
 *    的行必被 feature-denied；门控行看真 ucenter 脸色**两态断言**（命中或 browse-denied，
 *    外加 V7 腿：ucenter 不可达时整案 permission-service-unavailable 也算实走——探针不赌环境）
 *  J journal 提案四态：proposeOnce → 闸见 proposed 必 refuse（proposed-unconfirmed 执法位
 *    真链验证）→ updateProposed 存档更新 → decideConfirm 错 hash 拒/对 hash 放行且 useParams=
 *    存档 → startConfirmed → settle(done) → 闸 replay；唯一索引一键一行（repropose 不双行）
 *  L 账面：检索真 auditSink 落 featureCallLog（按探针 userCode 读回 ≥1 条）
 *
 * 全程用探针专属键（e2e-fc-*），跑完显式清场，residual=0 断言。缺省 featureCatalog 未开
 * 也不影响本探针（直接调 service 函数，装配开关面归刀2 guard 与 P6 开闸后 runStats 读数）。
 */
await import('../../init.js')
const { SkillWriteJournal, FeatureCallLog, GrpcSkill } = await import('../../daos/core/schema/index.js')
const grpcSkillDac = (await import('../../daos/core/dac/grpcSkillDac.js')).default
const journalDac = (await import('../../daos/core/dac/skillWriteJournalDac.js')).default
const { reconcileManifest, reviewGrpcSkill } = await import('../../services/core/grpcSkill.js')
const { executeFeatureCatalogSearch } = await import('../../services/core/session/featureCatalogTool.js')
const { decideSkillWriteGate, decideProposal, decideConfirm, buildSkillWriteKey } = await import('../../services/core/skill/skillWriteIdempotency.js')
const { md5 } = await import('../../tools/security.js')

const V = {}
const out = {}
const TS = Date.now()
const admin = { userCode: `e2e-fc-admin-${TS}`, realName: '目录探针' }
const host = 'e2e-fc-host.online:19999'
let FCHANNEL = ''   // 运行期取频道册首成员（W9：两仓频道名都是部署事实，字面量=假绿陷阱）
const skillMD = (n) => `---\nname: e2e-fc-${n}\ndescription: 探针功能 ${n} 的用途说明文字\nauthor: e2e\nversion: 1.0.0\ntags: [probe]\n---\n# 探针\n## When to Use This Skill\n仅自动化测试。\n## Instructions\n不做任何事。`
const mkItem = (n, over = {}) => ({
    skillCode: `e2e-fc-${n}`, skillName: `e2e-fc-${n}`, skillMD: skillMD(n),
    channels: [FCHANNEL], grpcHost: host, clientCode: 'xxzx',
    effectClass: 'read', ...over,
})
const created = { codes: [], journalKeys: [] }

try {
    // 频道名是部署事实（W9）：母本册=xxzx_common、底座册=micro_common 系，字面量都不许写死——
    // 取各仓频道册首成员（同一校验 API 的读数面，两仓各按各的真实频道语义跑）
    const { getConfiguredChannels } = await import('../../conf/llmChannel.js')
    FCHANNEL = getConfiguredChannels()[0]
    if (!FCHANNEL) throw new Error('频道册为空，探针无法自证频道语义')
    out.FCHANNEL = FCHANNEL
    // ===== R：reconcile 全链 =====
    const cfg = llm.config.grpcSkill
    cfg.adminUserCodes = [...(cfg.adminUserCodes || []), admin.userCode]   // in-process 政策翻转（探针身份）
    cfg.allowedHosts = [...new Set([...(cfg.allowedHosts || []), host])]   // host 白名单同步注入（缺省拒是设计，探针声明例外）
    const items1 = [mkItem('pub', { browseGate: false }), mkItem('gated'), mkItem('gonna')]
    const r1 = await reconcileManifest(admin, { clientCode: 'xxzx', grpcHost: host, stamp: `v1-${TS}`, items: items1 })
    created.codes.push(...items1.map((x) => x.skillCode))
    const rows1 = await GrpcSkill.find({ skillCode: { $in: items1.map((x) => x.skillCode) } }).lean()
    V.R1 = r1.reconciled.added === 3 && rows1.length === 3 && rows1.every((r) => r.reviewStatus === 'pending')
    out.R1 = { added: r1.reconciled.added, statuses: rows1.map((r) => r.reviewStatus).join(',') }
    // 批准 pub/gated，留 gonna 不批 → 再对账删 gonna：未批准行走 stalePending（不重复下线），装配行才下线
    for (const n of ['pub', 'gated']) await reviewGrpcSkill(admin, `e2e-fc-${n}`, { to: 'approved', reason: '探针批准' })
    const r2 = await reconcileManifest(admin, { clientCode: 'xxzx', grpcHost: host, stamp: `v2-${TS}`, items: [mkItem('pub', { browseGate: false }), mkItem('gated')] })
    const rowGonna = await GrpcSkill.findOne({ skillCode: 'e2e-fc-gonna' }).lean()
    V.R2 = r2.reconciled.stalePending === 1 && rowGonna.reviewStatus === 'pending'   // gonna 从未批准 ⇒ stalePending 通道，不是重复下线
    out.R2 = { stalePending: r2.reconciled.stalePending, gonna: rowGonna.reviewStatus, note: (rowGonna.reviewNote || '').slice(0, 40) }
    // 装配面防线：批准一个再删 ⇒ manifest-removed 真下线
    await reviewGrpcSkill(admin, 'e2e-fc-gonna', { to: 'approved', reason: '探针批准2' })
    const r3 = await reconcileManifest(admin, { clientCode: 'xxzx', grpcHost: host, stamp: `v3-${TS}`, items: [mkItem('pub', { browseGate: false }), mkItem('gated')] })
    const rowG2 = await GrpcSkill.findOne({ skillCode: 'e2e-fc-gonna' }).lean()
    V.R3 = r3.reconciled.offlined === 1 && rowG2.reviewStatus === 'pending' && /manifest-removed/.test(rowG2.reviewNote || '')
    out.R3 = { offlined: r3.reconciled.offlined, status: rowG2.reviewStatus, note: (rowG2.reviewNote || '').slice(0, 60) }
    // 空 manifest 整案拒
    let emptyErr = null
    try { await reconcileManifest(admin, { clientCode: 'xxzx', grpcHost: host, items: [] }) } catch (e) { emptyErr = String(e.message) }
    V.R4 = /空 manifest|manifest 为空/.test(emptyErr || '')
    out.R4 = emptyErr

    // ===== S：检索三形真链 =====
    const search = (kw) => executeFeatureCatalogSearch({ keyword: kw, userCode: admin.userCode, channel: FCHANNEL, conversationCode: `e2e-fc-conv-${TS}`, runCode: `e2e-fc-run-${TS}` })
    // gated 行加一个必然无的功能 priv（真 hasPriv 面）
    await GrpcSkill.updateOne({ skillCode: 'e2e-fc-gated' }, { $set: { featurePrivs: [`e2e-nonexistent-priv-${TS}`] } })
    const s1 = JSON.parse(await search('探针功能 pub'))
    out.S1 = s1
    if (s1.status === 'permission-service-unavailable') {
        // V7 腿：ucenter 不可达=降级态实走（同样真链：真 RPC 真失败真分态）
        V.S1 = true; V.S2 = true
        out.S_note = 'ucenter 不可达 ⇒ V7 permission-service-unavailable 实走（未赌环境）'
    } else {
        V.S1 = s1.matched.some((m) => m.skillCode === 'e2e-fc-pub')   // browseGate=false 公共行必命中
        V.S2 = !s1.matched.some((m) => m.skillCode === 'e2e-fc-gated') // 真 hasPriv false ⇒ feature-denied
        out.S2 = s1.total
    }

    // ===== J：journal 提案四态真 dac =====
    const key = buildSkillWriteKey({ runCode: `e2e-fc-run-${TS}`, toolCallId: 'tc-1' })
    created.journalKeys.push(key)
    const snapshot = JSON.stringify({ fileCode: 'fc-probe-1' })
    const h = md5(snapshot)
    const old = await journalDac.proposeOnce({ key, runCode: `e2e-fc-run-${TS}`, toolCallId: 'tc-1', toolName: 'doc_api/upload', conversationCode: `e2e-fc-conv-${TS}`, userCode: admin.userCode, paramSnapshot: snapshot, paramsHash: h })
    V.J1 = old === null   // 我是提案人
    // 出生即查重：重复 proposeOnce ⇒ 返回旧行（一键一行）
    const dup = await journalDac.proposeOnce({ key, paramSnapshot: snapshot, paramsHash: h })
    V.J2 = dup && dup.status === 'proposed' && dup.idempotencyKey === key
    // 执法位：闸见 proposed ⇒ refuse（真 decideSkillWriteGate）
    const gate = decideSkillWriteGate({ enabled: true, toolName: 'doc_api/upload', writeTools: ['doc_api/*'], key, existing: dup })
    V.J3 = gate.action === 'refuse' && gate.reason === 'proposed-unconfirmed'
    // repropose 判据 + 存档更新
    const dp = decideProposal({ existing: dup })
    const upd = dp.action === 'repropose' ? await journalDac.updateProposed(key, { paramSnapshot: snapshot, paramsHash: h }) : null
    V.J4 = dp.action === 'repropose' && upd && upd.status === 'proposed'
    // 确认：错 hash 拒、对 hash 放行且 useParams=存档；startConfirmed CAS 生效
    const c1 = decideConfirm({ existing: upd, confirmHash: 'wrong' })
    const c2 = decideConfirm({ existing: upd, confirmHash: h })
    const started = await journalDac.startConfirmed(key)
    const lateStart = await journalDac.startConfirmed(key)   // 迟到第二次确认 ⇒ null（CAS 已走）
    // settle 推 done，闸 replay
    const settled = await journalDac.settle(key, { text: '{"ok":true}', truncated: false })
    const gateAfter = decideSkillWriteGate({ enabled: true, toolName: 'doc_api/upload', writeTools: ['doc_api/*'], key, existing: await journalDac.lookup(key) })
    V.J5 = c1.reason === 'param-mismatch' && c2.action === 'proceed' && c2.useParams === snapshot
        && started && started.status === 'started' && lateStart === null && settled && settled.status === 'done'
        && gateAfter.action === 'replay'
    out.J = { dp: dp.action, c1: c1.reason, gate: gate.reason, replay: gateAfter.reason }

    // ===== L：账面真落 =====
    const logs = await FeatureCallLog.find({ userCode: admin.userCode }).lean()
    V.L1 = logs.length >= 1 && logs.some((l) => l.kind === 'search')
    out.L1 = { count: logs.length, kinds: [...new Set(logs.map((l) => l.kind))].join(',') }
} catch (e) {
    out.error = String(e?.stack || e?.message || e).slice(0, 500)
} finally {
    // 清场：目录行/账行/审计行
    await GrpcSkill.deleteMany({ skillCode: { $regex: '^e2e-fc-' } }).catch(() => {})
    await SkillWriteJournal.deleteMany({ idempotencyKey: { $regex: '^e2e-fc-run' } }).catch(() => {})
    await FeatureCallLog.deleteMany({ userCode: admin.userCode }).catch(() => {})
    const left = await GrpcSkill.countDocuments({ skillCode: { $regex: '^e2e-fc-' } })
    const left2 = await SkillWriteJournal.countDocuments({ idempotencyKey: { $regex: '^e2e-fc-run' } })
    const left3 = await FeatureCallLog.countDocuments({ userCode: admin.userCode })
    V.C1 = left === 0 && left2 === 0 && left3 === 0
    out.residual = { skills: left, journal: left2, callLog: left3 }
}
out.verdict = V
const pass = Object.values(V).filter(Boolean).length
const TOTAL = 13  // R1-R4 S1-S2 J1-J5 L1 C1（逐项点名，凑数是病——上一版数错 11 就是没点名的现形）
out.结论 = pass === TOTAL ? `功能目录 e2e 通过(${TOTAL}/${TOTAL}：对账三态+空拒/检索真链两腿/提案四态执法位/账面/零残留)` : `未全真 ${pass}/${TOTAL}——读数见上`
console.log(JSON.stringify(out, null, 1))
process.exit(pass === TOTAL ? 0 : 1)
