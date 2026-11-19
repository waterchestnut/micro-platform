/**
 * @fileOverview 产物账行 → 工作区卡片字段的纯投影（刀 B；零依赖）
 * @module services/core/artifact/artifactRow
 * @description
 * 单独成件的理由与 messageView 同族：投影要能被离线穷举测，而 artifactQuery 的 IO 链
 * （dac→schema/index→mongo 连接）不该进单测进程。缺席如实 null——"没记录"与"记录为 0"
 * 是两件事（估算列/关联列同款纪律第三次应用）。
 */
export function projectArtifactRow(r = {}) {
    return {
        artifactCode: r.artifactCode || '',
        name: r.name || null,
        kind: r.kind || null,
        state: r.state ?? null,
        integrity: r.integrity ?? null,
        version: Number.isFinite(Number(r.version)) ? Number(r.version) : null,
        parentArtifactCode: r.parentArtifactCode || null,
        lineageRootArtifactCode: r.lineageRootArtifactCode || null,
        sizeBytes: Number.isFinite(Number(r.sizeBytes)) ? Number(r.sizeBytes) : null,
        fileUrl: r.fileUrl || null,
        insertTime: r.insertTime || null,
        readyAt: r.readyAt || null,
    }
}

export default {projectArtifactRow}
