/**
 * @fileOverview 工具名的业务语义映射（Agent UI 演进刀 D；零依赖纯函数）
 * @module chatProviders/toolSemantics
 * @description
 * 调研对照（《从 Chat UI 到 Agent UI》第五章）：工具展示分两层——默认层说**业务含义**
 * （"正在搜索企业案例库"），展开才给技术细节（工具名/入参）。用户不关心 `search_web` 这个
 * 函数名，关心的是"它现在在替我干什么"。
 *
 * 性格（保守，与"不猜"纪律同族）：
 * 1. **映射表只收服务端真实存在的工具**（meta 帧 tools 清单实测形状），一个不落的对照在
 *    用例里钉住——表是运维/开发契约，不是文案灵感。
 * 2. **未知工具 ⇒ 回退原名**：没有映射就展示技术名本身，绝不编一句"正在努力处理"——
 *  假热情比陌生名词更糟（架构图"Generative UI 用受控组件"的同款边界）。
 * 3. 时态用"正在…"（进行中）与"已完成…"（done）两形——状态是数据，句式随状态变，
 *    不许把 done 说成进行中（runStats 三值同族的时态纪律）。
 */

/** 服务端工具名 → {doing 进行中说法, done 完成说法, failed? 业务失败说法}；新增工具先加表再上服务端
 *  failed 只给"回执到达但业务未成"有判定源的行（save_artifact 的 success 旗标在投影层可读）；
 *  不发明通用句——没有失败判定的工具走 done/doing 两形照旧 */
const SEMANTICS: Record<string, {doing: string; done: string; failed?: string}> = {
  search_web: {doing: '正在搜索网络', done: '已完成网络搜索'},
  get_website: {doing: '正在读取网页', done: '已读取网页'},
  get_current_datetime: {doing: '正在获取当前时间', done: '已获取当前时间'},
  run_code: {doing: '正在执行代码', done: '代码执行完成'},
  read_tool_result: {doing: '正在读回工具结果', done: '已读回工具结果'},
  update_plan: {doing: '正在更新执行计划', done: '已更新执行计划'},
  save_artifact: {doing: '正在保存产物', done: '已保存产物', failed: '产物保存失败'},
  read_artifact: {doing: '正在读取产物', done: '已读取产物'},
  memory_save: {doing: '正在写入长期记忆', done: '已写入长期记忆'},
  memory_search: {doing: '正在检索长期记忆', done: '已检索长期记忆'},
  memory_get: {doing: '正在读取长期记忆', done: '已读取长期记忆'},
  ask_user: {doing: '正在等待你的确认', done: '已收到你的回复'},
}

/**
 * @description 工具名 → 业务语义句。status='done' 用完成形，其余（pending/in_progress/缺省）用进行形；
 * 未知名/空名 ⇒ 原样返回（回退技术名，不编业务话）
 */
export function toolBusinessLabel(name?: string | null, status?: string): string {
  const key = typeof name === 'string' ? name.trim() : ''
  if (!key) return '未知工具'
  const s = SEMANTICS[key]
  if (!s) return key
  if (status === 'failed') return s.failed || s.done // 无失败判定的工具不许被投影层发明"失败"句
  return status === 'done' ? s.done : s.doing
}

/** 映射表键清单（用例对照服务端工具清单用；也是"新工具上线先补表"的提醒锚） */
export const KNOWN_TOOL_NAMES = Object.keys(SEMANTICS)

export default {toolBusinessLabel, KNOWN_TOOL_NAMES}
