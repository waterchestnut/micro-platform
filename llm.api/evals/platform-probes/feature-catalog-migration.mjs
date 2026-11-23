/**
 * @fileOverview 存量技能 → 功能目录条目迁移（Phase 2，dry-run/confirm 形制）
 * @module evals/platform-probes/feature-catalog-migration
 * @description
 * 给在册 grpcSkill 行补目录语义（effectClass/featurePrivs/sourceManifest），
 * 判据单源 featureManifest.planFeatureMigration——**迁移=补标注不是改行为**：
 * P6 开闸（featureCatalog.enabled）前装配过滤不生效，本次写入现网调用面逐字不变；
 * browseGate/真 privs 留属主随 ucenter priv 建档逐条核定（脚本不硬编未核事实）。
 *
 * 用法：
 *   node evals/platform-probes/feature-catalog-migration.mjs              # dry-run 全表
 *   node evals/platform-probes/feature-catalog-migration.mjs --confirm=WRITE
 * 幂等：已显式 effectClass 的行 skip（重跑零写）；写面逐行 dac.update 只 $set 三个新键，
 * skillMD/reviewStatus/hash 全不触碰（批准链不断）。
 */
await import('../../init.js')
const { SkillWriteJournal } = await import('../../daos/core/schema/index.js')
void SkillWriteJournal
const grpcSkillDac = (await import('../../daos/core/dac/grpcSkillDac.js')).default
const { planFeatureMigration } = await import('../../services/core/skill/featureManifest.js')
const { md5 } = await import('../../tools/security.js')
const skillJournalDac = (await import('../../daos/core/dac/skillJournalDac.js')).default

const CONFIRM = process.argv.includes('--confirm=WRITE')
const rows = (await grpcSkillDac.getTop(1000, {})) || []
const { plan } = planFeatureMigration(rows)
const byCode = new Map(rows.map((r) => [String(r.skillCode), r]))

console.log(`grpcSkill 现有行: ${rows.length} | tag 计划: ${plan.filter((x) => x.action === 'tag').length} | skip: ${plan.filter((x) => x.action === 'skip').length}`)
for (const x of plan) {
    const row = byCode.get(String(x.skillCode))
    console.log(`  [${x.action}] ${x.skillCode} (${row?.skillName || ''}) host=${row?.grpcHost || '-'} channels=${(row?.channels || []).join(',')} | ${x.reason}`)
    if (x.action === 'tag' && CONFIRM) {
        await grpcSkillDac.update(x.add, { skillCode: x.skillCode })
        // 留痕 actor=migration（skillWriteJournal 词表同族先例）：审计能回答"这批目录语义谁给的"
        await skillJournalDac.add({
            skillCode: x.skillCode, skillName: row?.skillName || '', actor: 'migration', op: 'update',
            actorUser: { userCode: 'system', realName: 'feature-catalog-migration' },
            before: { effectClass: row?.effectClass ?? '(absent)' },
            after: { effectClass: x.add.effectClass, featurePrivs: x.add.featurePrivs, sourceManifest: x.add.sourceManifest },
            evidence: [{ hash: md5(JSON.stringify(x.add)) }],
            reason: 'Phase2 存量迁移：补目录语义（行为不变，browseGate/privs 留核定）',
        }).catch(() => {})
    }
}
if (!CONFIRM) {
    console.log('[dry-run] 未写库。执行真迁移加 --confirm=WRITE')
} else {
    const left = (await grpcSkillDac.getTop(1000, {})) || []
    const missing = left.filter((r) => r.skillCode && typeof r.effectClass !== 'string').map((r) => r.skillCode)
    console.log(`WRITE 完成。复核无 effectClass 的行: ${missing.length}`, missing.length ? JSON.stringify(missing) : '')
}
process.exit(0)
