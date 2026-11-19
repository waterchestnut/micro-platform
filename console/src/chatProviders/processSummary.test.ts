/**
 * 过程摘要行/分组判据（现代化刀一）。摘要行是"这轮做了什么"的第一句人话——
 * 每个"不说"都必须有理由（没数据不说、空串不渲染），每个"说"都必须有出处。
 */
import {
  processSummaryLine,
  processCollapsedByDefault,
  processGroupOf,
  PROCESS_GROUP_META,
  durationText,
} from './processSummary';

describe('durationText：没有时长数据就不说时长', () => {
  test('三档格式', () => {
    expect(durationText(800)).toBe('0.8 秒')
    expect(durationText(12400)).toBe('12.4 秒')
    expect(durationText(75000)).toBe('1 分 15 秒')
    expect(durationText(120000)).toBe('2 分')
  })
  test('null/负数/非数 ⇒ null——"约 0 秒"是被禁止的形状（lostChars 同训）', () => {
    expect(durationText(null)).toBeNull()
    expect(durationText(undefined)).toBeNull()
    expect(durationText(-5)).toBeNull()
    expect(durationText('x' as any)).toBeNull()
    expect(durationText(0)).toBe('0.0 秒') // 0 是"量到过"的真值，与"没数据"不同
  })
})

describe('processSummaryLine：只拼数得出的事实', () => {
  test('全空 ⇒ 空串（面板不渲染摘要）', () => {
    expect(processSummaryLine({})).toBe('')
    expect(processSummaryLine({segments: [], toolCalls: [], sources: []})).toBe('')
  })
  test('常见轮次：工具+时长+来源+上下文按序拼接', () => {
    const line = processSummaryLine({
      toolCalls: [{name: 'search_web'}, {name: 'run_code'}],
      segments: [{metrics: {ms: 5200}}, {metrics: {ms: 3000}}],
      sources: [{}, {}, {}],
      usage: {total: 6698, budget: 66976},
    })
    expect(line).toBe('调用工具 2 次 · 8.2 秒 · 引用 3 条来源 · 上下文 10%')
  })
  test('段无 ms/脏 ms ⇒ 时长段整个消失（不是"0 秒"）', () => {
    const line = processSummaryLine({toolCalls: [{}, {}], segments: [{metrics: {}}, {metrics: {ms: -1}}, {}]})
    expect(line).toBe('调用工具 2 次')
  })
  test('fromCache 进摘要；usage 缺 budget ⇒ 不说百分比（分母没有=百分比是编的）', () => {
    expect(processSummaryLine({fromCache: true})).toBe('来自缓存')
    expect(processSummaryLine({usage: {total: 100}})).toBe('')
    expect(processSummaryLine({usage: {total: 100, budget: 0}})).toBe('')
  })
})

describe('processCollapsedByDefault：两态一规则', () => {
  test('流式中展开（跟随=它还活着），终局收起（结果才是主角）', () => {
    expect(processCollapsedByDefault(true)).toBe(false)
    expect(processCollapsedByDefault(false)).toBe(true)
    expect(processCollapsedByDefault(undefined)).toBe(true) // 读不到流式态按终局处理（历史回放默认收起）
  })
})

describe('分组判据：按 key 归组，未知不失踪', () => {
  test('已知 key 三组齐', () => {
    expect(processGroupOf('tools')).toBe('tools')
    expect(processGroupOf('model-calls')).toBe('tools')
    expect(processGroupOf('sources')).toBe('refs')
    expect(processGroupOf('skills')).toBe('refs')
    expect(processGroupOf('context')).toBe('refs')
    expect(processGroupOf('segments-dropped')).toBe('flow')
    expect(processGroupOf('run-overlap')).toBe('flow')
  })
  test('未知 key（服务端未来加的新段类）落 flow——保守可见，不从面板失踪', () => {
    expect(processGroupOf('brand-new-thing')).toBe('flow')
    expect(processGroupOf('seg-3')).toBe('flow')
  })
  test('组顺序稳定：flow → tools → refs', () => {
    const order = (Object.keys(PROCESS_GROUP_META) as Array<keyof typeof PROCESS_GROUP_META>)
      .sort((a, b) => PROCESS_GROUP_META[a].order - PROCESS_GROUP_META[b].order)
    expect(order).toEqual(['flow', 'tools', 'refs'])
  })
})
