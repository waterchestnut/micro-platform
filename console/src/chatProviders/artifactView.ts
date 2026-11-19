/**
 * @fileOverview 产物工作区的纯判据（Agent UI 刀 B；零依赖）
 * @module chatProviders/artifactView
 * @description
 * 与 messageParts 同族纪律：判据离开渲染单独穷举。这里三件事都"缺席如实"——
 * 没记到的数不许显示成 0/空标题（估算列/关联列同款第三次应用）。
 */

export type ArtifactLike = {
  artifactCode: string;
  name?: string | null;
  kind?: string | null;
  state?: string | null;
  sizeBytes?: number | null;
  version?: number | null;
  parentArtifactCode?: string | null;
  lineageRootArtifactCode?: string | null;
  insertTime?: string | null;
  readyAt?: string | null;
};

/**
 * @description 字节数 → 人话。非有限数（含 null/undefined/脏值）⇒ null（"没记录"不是 0 KB）；
 * <1 KB 显示 B（小产物不许四舍五入成 "0 KB" 显得是空的）
 */
export function formatArtifactSize(bytes?: number | null): string | null {
  // null/undefined 显式先判——Number(null)===0 陷阱第三次现身（这次是自家用例当场抓的）
  const n = Number(bytes)
  if (bytes === null || bytes === undefined || !Number.isFinite(n) || n < 0) return null
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  if (n >= 1024) return `${Math.ceil(n / 1024)} KB`
  return `${Math.round(n)} B`
}

/** 卡片/列表标题：name 优先；无 name ⇒ artifactCode 短形（识别符本来就是给人看的兜底） */
export function artifactDisplayName(a?: ArtifactLike | null): string {
  const name = typeof a?.name === 'string' ? a.name.trim() : ''
  if (name) return name
  const code = typeof a?.artifactCode === 'string' ? a.artifactCode.trim() : ''
  if (!code) return '未命名产物'
  return code.length > 16 ? `${code.slice(0, 14)}…` : code
}

/**
 * @description 列表分组：同一血缘（lineageRoot，无则自身）归组，组间按最新时间新在前，
 * 组内按版本老→新（读版本链要顺着读，组的位置要按新活动排）。
 * 时间读不到 ⇒ 按组尾排最后（不猜"现在"——null 排序是数据缺失，不是最新事件）。
 */
export function groupArtifactsByLineage(rows: ArtifactLike[]): ArtifactLike[][] {
  const byKey = new Map<string, ArtifactLike[]>()
  for (const r of rows || []) {
    const key = r?.lineageRootArtifactCode || r?.artifactCode
    if (!key) continue
    const g = byKey.get(key)
    if (g) g.push(r)
    else byKey.set(key, [r])
  }
  const t = (a?: ArtifactLike | null) => {
    const raw = a?.readyAt || a?.insertTime
    const ms = raw ? Date.parse(String(raw)) : NaN
    return Number.isFinite(ms) ? ms : -1
  }
  const groups = [...byKey.values()]
  for (const g of groups) g.sort((x, y) => (Number(x.version) || 0) - (Number(y.version) || 0) || t(x) - t(y))
  groups.sort((x, y) => t(y[y.length - 1]) - t(x[x.length - 1]))
  return groups
}

export default {formatArtifactSize, artifactDisplayName, groupArtifactsByLineage}
