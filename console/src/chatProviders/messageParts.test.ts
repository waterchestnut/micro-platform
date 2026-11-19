/**
 * Message Part 投影判据（Agent UI 刀 A）。投影规则的每条都有被绕过的可能——
 * 顺序、剔除、取末份、防御归一，全靠用例钉死；渲染层只消费这里的结论。
 */
import {projectMessageParts, projectPlan, projectArtifactFromCall, projectToolRuns, shouldCollapseText} from './messageParts';

describe('projectPlan：取最后一份有效计划（整份替换语义）', () => {
  test('args 为 JSON 字符串（档案形）与对象（流式形）都认', () => {
    const fromString = projectPlan([{name: 'update_plan', args: '{"items":[{"title":"读文件","status":"done"},{"title":"分析","status":"in_progress"}]}'}])
    expect(fromString!.steps).toEqual([
      {id: undefined, title: '读文件', status: 'done'},
      {id: undefined, title: '分析', status: 'in_progress'},
    ])
    const fromObj = projectPlan([{name: 'update_plan', args: {items: [{id: 'a', title: 'A', status: 'pending'}]}}])
    expect(fromObj!.steps[0]).toEqual({id: 'a', title: 'A', status: 'pending'})
  })
  test('多次调用取最后一次（前面的不是当前状态）', () => {
    const p = projectPlan([
      {name: 'update_plan', args: {items: [{title: 'v1'}]}},
      {name: 'update_plan', args: {items: [{title: 'v2', status: 'done'}]}},
    ])
    expect(p!.steps).toEqual([{id: undefined, title: 'v2', status: 'done'}])
  })
  test('防御归一：坏 JSON/缺 title/非法 status ⇒ 丢条目或按 pending，不崩不猜', () => {
    expect(projectPlan([{name: 'update_plan', args: '{broken'}])).toBeNull()
    expect(projectPlan([{name: 'update_plan', args: {items: [{status: 'done'}]}}])).toBeNull() // 无 title 条目丢弃后为空
    const p = projectPlan([{name: 'update_plan', args: {items: [{title: 'A', status: 'weird'}, {title: 'B'}]}}])
    expect(p!.steps.map((s) => s.status)).toEqual(['pending', 'pending'])
  })
  test('无 update_plan ⇒ null（不硬造计划块）', () => {
    expect(projectPlan([{name: 'search_web'}])).toBeNull()
    expect(projectPlan([])).toBeNull()
  })
  test('note 有则带、空串/缺省不带键', () => {
    expect(projectPlan([{name: 'update_plan', args: {items: [{title: 'A'}], note: '收窄范围'}}])!.note).toBe('收窄范围')
    expect('note' in projectPlan([{name: 'update_plan', args: {items: [{title: 'A'}], note: '  '}}])!).toBe(false)
  })
})

describe('projectMessageParts：顺序=结果优先，空块不出', () => {
  test('完整一轮的块序：notice → 正文 → 计划 → 工具 → 来源', () => {
    const parts = projectMessageParts({
      taskNote: '任务已受理：3 个子任务并行执行中',
      content: '答案正文',
      toolCalls: [
        {id: '1', name: 'update_plan', args: {items: [{title: '步骤一', status: 'done'}]}},
        {id: '2', name: 'search_web', args: '{}'},
      ],
      sources: [{title: '来源A'}],
    })
    expect(parts.map((p) => p.type)).toEqual(['notice', 'text', 'plan', 'tools', 'sources'])
  })
  test('update_plan 从工具列表剔除（同一数据不在两处显示）', () => {
    const parts = projectMessageParts({
      toolCalls: [{id: '1', name: 'update_plan', args: {items: [{title: 'A'}]}}, {id: '2', name: 'run_code'}],
    })
    const tools = parts.find((p) => p.type === 'tools') as any
    expect(tools.calls).toHaveLength(1)
    expect(tools.calls[0].name).toBe('run_code')
  })
  test('error 块在正文前（拒绝原因先于内容被读到）；resumeNote 也是 notice', () => {
    const parts = projectMessageParts({errorText: '上一条还在处理', content: 'x', resumeNote: '续接未成功'})
    expect(parts.map((p) => p.type)).toEqual(['notice', 'error', 'text'])
  })
  test('全空 ⇒ []（渲染层回退旧路径）；纯文本轮只有一个 text 块', () => {
    expect(projectMessageParts({})).toEqual([])
    expect(projectMessageParts(null)).toEqual([])
    expect(projectMessageParts({content: '   '})).toEqual([])
    expect(projectMessageParts({content: '只有回答'})).toEqual([{type: 'text', text: '只有回答'}])
  })
  test('plan 的 done/total 是计数派生（渲染层不许自己数）', () => {
    const parts = projectMessageParts({
      toolCalls: [{id: '1', name: 'update_plan', args: {items: [{title: 'A', status: 'done'}, {title: 'B', status: 'failed'}, {title: 'C'}]}},
    ]})
    const plan = parts.find((p) => p.type === 'plan') as any
    expect({done: plan.done, total: plan.total}).toEqual({done: 1, total: 3})
  })
})

describe('projectArtifactFromCall：save_artifact 回执 → 产物卡数据（刀 B）', () => {
  const ok = (data: any) => JSON.stringify({success: true, data})
  test('成功回执抽出 artifactCode/name/kind/sizeBytes；非 save_artifact/失败/坏 JSON ⇒ null', () => {
    expect(projectArtifactFromCall({name: 'save_artifact', result: ok({artifactCode: 'art-1', name: '报告.md', kind: 'file', sizeBytes: 2048})}))
      .toEqual({artifactCode: 'art-1', name: '报告.md', kind: 'file', sizeBytes: 2048})
    expect(projectArtifactFromCall({name: 'search_web', result: ok({artifactCode: 'x'})})).toBeNull()
    expect(projectArtifactFromCall({name: 'save_artifact', result: '{"success":false,"error":"配额不足"}'})).toBeNull()
    expect(projectArtifactFromCall({name: 'save_artifact', result: '{坏'})).toBeNull() // 截断/坏 JSON 不猜半份卡
    expect(projectArtifactFromCall({name: 'save_artifact', result: ok({name: '没码'})})).toBeNull()
    expect(projectArtifactFromCall(null)).toBeNull()
  })
  test('缺席字段不带键（空 name 不渲染成《》）；code 两端空白裁掉', () => {
    const a = projectArtifactFromCall({name: 'save_artifact', result: ok({artifactCode: ' art-2 ', name: '  ', sizeBytes: null})})
    expect(a).toEqual({artifactCode: 'art-2'})
    expect('name' in a!).toBe(false)
    expect('sizeBytes' in a!).toBe(false)
  })
})

describe('产物块接线进消息投影（刀 B）', () => {
  const saveOk = (data: any) => JSON.stringify({success: true, data})
  test('块序：正文 → 产物 → 计划 → 工具（产物是本轮产出，紧跟结果优先）；成功卡从工具列表剔除', () => {
    const parts = projectMessageParts({
      content: '调研完成',
      toolCalls: [
        {id: '1', name: 'search_web', status: 'done'},
        {id: '2', name: 'save_artifact', status: 'done', result: saveOk({artifactCode: 'art-1', name: '报告.md', kind: 'file', sizeBytes: 2048})},
        {id: '3', name: 'update_plan', args: {items: [{title: 'A', status: 'done'}]}},
      ],
    })
    expect(parts.map((p) => p.type)).toEqual(['text', 'artifact', 'plan', 'tools'])
    const tools = parts.find((p) => p.type === 'tools') as any
    expect(tools.calls.map((c: any) => c.id)).toEqual(['1']) // 成功的 save_artifact 不再出现在工具行
  })
  test('失败回执：不出卡、**留在**工具列表且副本标 failed（原对象不动——ProcessPanel 共用它）', () => {
    const raw = {id: '9', name: 'save_artifact', status: 'done', result: '{"success":false,"error":"intake 未成功"}'}
    const parts = projectMessageParts({toolCalls: [raw]})
    expect(parts.map((p) => p.type)).toEqual(['tools'])
    const tools = parts[0] as any
    expect(tools.calls[0]).toMatchObject({id: '9', status: 'failed'})
    expect(raw.status).toBe('done') // 源未被渲染层改写
  })
  test('多次保存=多张卡（版本链每版都可见），卡间保持调用顺序', () => {
    const parts = projectMessageParts({
      toolCalls: [
        {id: '1', name: 'save_artifact', result: saveOk({artifactCode: 'a1', name: 'v1.md'})},
        {id: '2', name: 'search_web'},
        {id: '3', name: 'save_artifact', result: saveOk({artifactCode: 'a2', name: 'v2.md'})},
      ],
    })
    expect(parts.filter((p) => p.type === 'artifact').map((p: any) => p.artifactCode)).toEqual(['a1', 'a2'])
  })
})

describe('projectToolRuns：连续同名同状态折行（属主 2026-11-19）', () => {
  test('三连搜索折成一行 ×3；穿插代码后重新起算（时间节奏不许抹平）', () => {
    const runs = projectToolRuns([
      {id: '1', name: 'search_web', status: 'done'},
      {id: '2', name: 'search_web', status: 'done'},
      {id: '3', name: 'search_web', status: 'done'},
      {id: '4', name: 'run_code', status: 'done'},
      {id: '5', name: 'search_web', status: 'done'},
    ])
    expect(runs.map((r) => [r.name, r.status, r.count])).toEqual([['search_web', 'done', 3], ['run_code', 'done', 1], ['search_web', 'done', 1]])
  })
  test('状态参与分组：done×2 + pending×1 不折成"已完成 ×3"（那是谎报）', () => {
    const runs = projectToolRuns([
      {id: '1', name: 'get_website', status: 'done'},
      {id: '2', name: 'get_website', status: 'done'},
      {id: '3', name: 'get_website', status: 'pending'},
    ])
    expect(runs.map((r) => [r.status, r.count])).toEqual([['done', 2], ['pending', 1]])
  })
  test('status 缺省=done（与 resolveToolCalls 同口径）；空/非组输入不崩', () => {
    expect(projectToolRuns([{name: 'search_web'}])).toEqual([{key: 'i0', name: 'search_web', status: 'done', count: 1}])
    expect(projectToolRuns([])).toEqual([])
    expect(projectToolRuns(null as any)).toEqual([])
  })
})

describe('shouldCollapseText：长文折叠阈值', () => {
  test('严格大于 1000 字才折；短文本/非串 false（不给人添一次点击）', () => {
    expect(shouldCollapseText('字'.repeat(1000))).toBe(false)
    expect(shouldCollapseText('字'.repeat(1001))).toBe(true)
    for (const bad of [undefined, null, '', 'x']) expect(shouldCollapseText(bad as any)).toBe(false)
  })
})
