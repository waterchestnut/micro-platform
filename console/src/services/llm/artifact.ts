/**
 * @fileOverview 会话产物的读面（Agent UI 刀 B 前端工作区的 IO 层）
 * @module services/llm/artifact
 * @description
 * 对应 llm.api `/core/artifact/list|read`（服务端 e2e 4/4 已过：投影齐/403/状态闸拒/404）。
 * 信封口径与 agentTask.ts 同款（`ret.code === 0 ⇒ ret.data`，llm.api 手写信封）。
 * IO 兜底纪律（观测面）：列表拉不到 ⇒ 空数组（面板说"暂无产物"还是"读不到"由调用方按
 * ok 旗标区分——这里不能把网络失败洗成空列表，那是两种真话）；读回失败 ⇒ {ok:false,error 如实}。
 */
import {llmRequest} from '@/services/request';

export type ArtifactRow = {
  artifactCode: string;
  name?: string | null;
  kind?: string | null;
  state?: string | null;
  integrity?: string | null;
  version?: number | null;
  parentArtifactCode?: string | null;
  lineageRootArtifactCode?: string | null;
  sizeBytes?: number | null;
  fileUrl?: string | null;
  insertTime?: string | null;
  readyAt?: string | null;
};

export type ArtifactListResult = {ok: boolean; items: ArtifactRow[]; error?: string};

/** 会话产物清单（新在前）。可见性=会话成员制，服务端已把关 */
export async function listConversationArtifacts(conversationCode: string): Promise<ArtifactListResult> {
  if (!conversationCode) return {ok: false, items: [], error: '缺少会话标识'};
  try {
    const ret: any = await llmRequest('/core/artifact/list', {method: 'POST', data: {conversationCode}});
    if (ret?.code === 0 && Array.isArray(ret?.data?.items)) return {ok: true, items: ret.data.items};
    return {ok: false, items: [], error: String(ret?.msg || '产物清单读取失败')};
  } catch (e: any) {
    return {ok: false, items: [], error: String(e?.message || '网络异常，产物清单未送达')};
  }
}

export type ArtifactPage = {
  ok: boolean;
  text?: string;
  offset?: number;
  totalChars?: number;
  remainingChars?: number;
  hasMore?: boolean;
  /** 失败原因（服务端执行体的拒法原文：未入库/无 fileCode/超字节上限…） */
  error?: string;
};

/** 分页读回产物正文；状态闸在服务端执行体（readArtifactPage 不预判、不美化拒法） */
export async function readArtifactPage(artifactCode: string, offset = 0, limit?: number): Promise<ArtifactPage> {
  if (!artifactCode) return {ok: false, error: '缺少产物标识'};
  try {
    const ret: any = await llmRequest('/core/artifact/read', {
      method: 'POST',
      data: {artifactCode, offset, ...(limit ? {limit} : {})},
    });
    const body = ret?.code === 0 ? ret?.data : null;
    if (!body) return {ok: false, error: String(ret?.msg || '产物读取失败')};
    if (body.success !== true) return {ok: false, error: String(body.error || '产物读取未成功')};
    const d = body.data || {};
    return {
      ok: true,
      text: typeof d.text === 'string' ? d.text : '',
      offset: Number.isFinite(Number(d.offset)) ? Number(d.offset) : offset,
      totalChars: Number.isFinite(Number(d.totalChars)) ? Number(d.totalChars) : undefined,
      remainingChars: Number.isFinite(Number(d.remainingChars)) ? Number(d.remainingChars) : undefined,
      hasMore: d.hasMore === true,
    };
  } catch (e: any) {
    return {ok: false, error: String(e?.message || '网络异常，产物内容未送达')};
  }
}
