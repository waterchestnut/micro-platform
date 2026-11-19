/**
 * 产物工作区判据（刀 B）。与 messageParts.test 同族：判据先于渲染穷举。
 */
import {formatArtifactSize, artifactDisplayName, groupArtifactsByLineage, type ArtifactLike} from './artifactView';

describe('formatArtifactSize', () => {
  test('缺席/脏值 ⇒ null（"没记录"不显示成 0 B）；负数同拒', () => {
    for (const bad of [null, undefined, NaN, 'abc', -1]) {
      expect(formatArtifactSize(bad as any)).toBeNull()
    }
    expect(formatArtifactSize()).toBeNull()
  })
  test('单位阶梯：B 段不许四舍五入成 "0 KB"；KB 向上取整；MB 一位小数', () => {
    expect(formatArtifactSize(0)).toBe('0 B') // 显式记录的 0 与缺席是两回事
    expect(formatArtifactSize(999)).toBe('999 B')
    expect(formatArtifactSize(1024)).toBe('1 KB')
    expect(formatArtifactSize(1500)).toBe('2 KB')
    expect(formatArtifactSize(2048 * 1024)).toBe('2.0 MB')
  })
})

describe('artifactDisplayName', () => {
  test('name 优先；无 name ⇒ code 短形；两者皆空 ⇒ 固定占位（不渲染空标题）', () => {
    expect(artifactDisplayName({artifactCode: 'art-1', name: ' 报告.md '})).toBe('报告.md')
    expect(artifactDisplayName({artifactCode: 'art-abcdef0123456789'})).toBe('art-abcdef0123…')
    expect(artifactDisplayName({artifactCode: 'short'})).toBe('short')
    expect(artifactDisplayName({artifactCode: ''})).toBe('未命名产物')
    expect(artifactDisplayName(null)).toBe('未命名产物')
  })
})

describe('groupArtifactsByLineage', () => {
  const r = (p: Partial<ArtifactLike>): ArtifactLike => ({artifactCode: p.artifactCode!, ...p})
  test('同血缘归组（lineageRoot，无根用自身）；组间最新在前、组内版本老→新', () => {
    const groups = groupArtifactsByLineage([
      r({artifactCode: 'b2', lineageRootArtifactCode: 'b1', version: 2, readyAt: '2026-11-19T10:00:00Z'}),
      r({artifactCode: 'a1', version: 1, readyAt: '2026-11-19T12:00:00Z'}),
      r({artifactCode: 'b1', lineageRootArtifactCode: 'b1', version: 1, readyAt: '2026-11-18T10:00:00Z'}),
    ])
    expect(groups.map((g) => g.map((x) => x.artifactCode))).toEqual([['a1'], ['b1', 'b2']]) // a1 更新 ⇒ 组在前；链内老→新
  })
  test('时间读不到 ⇒ 排最后（null 排序=数据缺失，不是"现在"——Number(null) 陷阱同族）', () => {
    const groups = groupArtifactsByLineage([
      r({artifactCode: 'noTime'}),
      r({artifactCode: 't1', insertTime: '2026-01-01T00:00:00Z'}),
    ])
    expect(groups.map((g) => g[0].artifactCode)).toEqual(['t1', 'noTime'])
  })
  test('version 脏值按 0 排链首（可讨论，但必须稳定）；无 code 的脏行丢弃不崩', () => {
    const groups = groupArtifactsByLineage([
      r({artifactCode: 'x2', lineageRootArtifactCode: 'x1', version: 'abc' as any, insertTime: '2026-01-02T00:00:00Z'}),
      r({artifactCode: 'x1', version: 1, insertTime: '2026-01-01T00:00:00Z'}),
      {name: '没身份'} as any,
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].map((x) => x.artifactCode)).toEqual(['x2', 'x1']) // 脏版本落 0 排头——展示层 v? 如实示脏
  })
})
