/**
 * 工具业务语义映射（刀 D）。表的性格：只收真实工具、未知回退原名、时态随状态。
 */
import {toolBusinessLabel, KNOWN_TOOL_NAMES} from './toolSemantics';

describe('toolBusinessLabel', () => {
  test('已知工具：进行形/完成形随状态切换，不把 done 说成进行中', () => {
    expect(toolBusinessLabel('search_web', 'pending')).toBe('正在搜索网络')
    expect(toolBusinessLabel('search_web', 'done')).toBe('已完成网络搜索')
    expect(toolBusinessLabel('run_code')).toBe('正在执行代码') // 缺省状态=进行形
    expect(toolBusinessLabel('ask_user', 'pending')).toBe('正在等待你的确认')
  })
  test('未知工具 ⇒ 原名回退——没有映射就展示技术名，绝不编"正在努力处理"（假热情比陌生名词更糟）', () => {
    expect(toolBusinessLabel('brand_new_tool', 'done')).toBe('brand_new_tool')
    expect(toolBusinessLabel('sandbox_exec')).toBe('sandbox_exec')
  })
  test('failed 形只有判定源的行才有（save_artifact 回执可读 success）；无失败形的工具不许被发明失败句', () => {
    expect(toolBusinessLabel('save_artifact', 'failed')).toBe('产物保存失败')
    expect(toolBusinessLabel('search_web', 'failed')).toBe('已完成网络搜索') // 回退 done 形：传输到没到达它管，业务成败它不知道
  })
  test('空/脏名 ⇒ 固定"未知工具"（不渲染空串让行看起来坏了）', () => {
    for (const bad of [null, undefined, '', '   ']) {
      expect(toolBusinessLabel(bad as any, 'done')).toBe('未知工具')
    }
  })
  test('映射表覆盖服务端工具清单的已知成员（新工具上线先补表——这条用例就是提醒锚）', () => {
    for (const t of ['search_web', 'get_website', 'get_current_datetime', 'run_code', 'read_tool_result',
      'update_plan', 'save_artifact', 'read_artifact', 'memory_save', 'memory_search', 'memory_get', 'ask_user']) {
      expect(KNOWN_TOOL_NAMES).toContain(t)
    }
  })
})
