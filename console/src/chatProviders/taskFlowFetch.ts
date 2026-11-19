/**
 * @fileOverview 流请求的"受理信封"分流包装（PR-任务编排 M8 第三仓刀一）
 * @module chatProviders/taskFlowFetch
 * @description
 * 只给 `/core/chat/stream` 用（resume 端点不会回受理信封——续接的目标轮早已在跑）。
 * 判到受理信封 ⇒ 抛带 name 的信号错误进 SDK 既有错误通道（`requestFallback` 念真话）；
 * 判不到 ⇒ **原样返回 resp**——SSE、4290/4291/4292 拒绝体（success:false）各行其道，
 * 现网路径逐字不变。这是"默认关等价于没接线"的同族纪律：没有编排信封时，本包装层
 * 对每个响应做的事只有 clone+看形状，一个字节都不改。
 *
 * 为什么不"合成一帧 SSE 把信封喂给 transformMessage"：那等于伪造一帧服务端从没发过
 * 的协议数据进渲染链——本仓对"双源一致"的账（实时流 vs 档案回放）会被这种假帧永久污染。
 */
import {matchQueuedAccepted, matchTaskAccepted, makeTaskFlowError} from './taskFlow';

type FetchLike = (input: any, init?: any) => Promise<any>;

/**
 * @description 包装版 fetch：透传一切，唯独把 200+JSON 的编排受理信封转成可分叉的信号
 * @param {Function} [doFetch] 注入的底层 fetch（测试面；缺省 globalThis.fetch）
 */
export function makeFetchWithTaskFlow(doFetch?: FetchLike) {
  return async (baseURL: any, options: any = {}) => {
    const f: FetchLike = doFetch || ((i: any, o: any) => (globalThis as any).fetch(i, o));
    const resp = await f(baseURL, options);
    try {
      const ct = String(resp?.headers?.get?.('content-type') || '');
      if (resp?.ok && ct.includes('application/json')) {
        // clone 才敢 peek：原 body 留给下游（非信封的 JSON——比如拒绝体——必须原样可读）
        const j = await resp.clone().json().catch(() => null);
        const accepted = matchTaskAccepted(j);
        if (accepted) throw makeTaskFlowError('accepted', accepted);
        const queued = matchQueuedAccepted(j);
        if (queued) throw makeTaskFlowError('queued', queued);
      }
    } catch (e: any) {
      if (e && typeof e.name === 'string' && (e.name === 'TaskAccepted' || e.name === 'TaskQueued')) throw e;
      /** 窥探面自身的任何失败（body 非 JSON/headers 缺失…）不许伤到主流——放行原响应 */
    }
    return resp;
  };
}

export default {makeFetchWithTaskFlow};
