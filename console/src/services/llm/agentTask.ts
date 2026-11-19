/**
 * @fileOverview 编排任务树的读写面（detail/cancel）（PR-任务编排 M8 第三仓刀二）
 * @module services/llm/agentTask
 * @description
 * `/core/agentTask/*` 是 llm.api 侧**手写**的 `{statusCode, code, data}` 信封——与
 * `llmRequest` 既有口径（`ret.code === 0` ⇒ `ret.data`）天然一致，这里不另造解包。
 * 观测面纪律（判据在 taskFlow，此处只做 IO 兜底）：detail 拉不到 ⇒ null，
 * 卡片继续用上一次快照/受理说明渲染——轮询是观测，网络抖动不许报成任务失败；
 * cancel 是**动作面**，失败必须如实回 {ok:false,msg} 给调用方去展示，不静默。
 */
import {llmRequest} from '@/services/request';
import {getMessageList} from './message';
import {pickLatestAnswer, type TaskDetailLite} from '@/chatProviders/taskFlow';

/** 任务详情（相位/子任务/树账）。读面不依赖编排 flag——dev 现在即可用（llm.api §5-3 事实）。 */
export async function researchTaskDetail(rootCode: string): Promise<TaskDetailLite | null> {
  if (!rootCode) return null;
  try {
    const ret = await llmRequest('/core/agentTask/detail', {method: 'POST', data: {agentCode: rootCode}});
    return (ret as any)?.code === 0 && (ret as any).data ? ((ret as any).data as TaskDetailLite) : null;
  } catch {
    return null;
  }
}

/** 取消任务（语义="不再聚合+停止追活"，在途子任务可能仍跑完——文案由调用方按 taskFlow 口径说） */
export async function researchTaskCancel(rootCode: string): Promise<{ok: boolean; msg: string}> {
  if (!rootCode) return {ok: false, msg: '缺少任务号'};
  try {
    const ret: any = await llmRequest('/core/agentTask/cancel', {method: 'POST', data: {agentCode: rootCode}});
    return {ok: ret?.code === 0, msg: String(ret?.msg || (ret?.code === 0 ? '' : '取消未生效'))};
  } catch (e: any) {
    return {ok: false, msg: String(e?.message || '网络异常，取消未送达')};
  }
}

/**
 * 综合正文读回：detail 的 synthesis 只有 {messageCode,usable}（**没有正文**，llm.api 事实），
 * 正文在 `root:<rootCode>` 隔离会话末条非空 answer——pickLatestAnswer 判据单源，读不到 ⇒ null
 * （卡片会说"未读到"，不拿标题凑一段）。
 */
export async function loadSynthesisBody(rootCode: string): Promise<string | null> {
  if (!rootCode) return null;
  try {
    const ret = await getMessageList(1, 10, {conversationCode: `root:${rootCode}`}, {total: false} as any);
    return pickLatestAnswer((ret as any)?.rows || [])?.text ?? null;
  } catch {
    return null;
  }
}
