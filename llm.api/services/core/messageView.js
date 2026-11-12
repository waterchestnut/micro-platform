/**
 * @fileOverview message 文档 → 调用方视图（纯函数，零依赖）
 * @module services/core/messageView
 * @description
 * **为什么把这两个函数从 `services/core/message.js` 搬出来**：那边一 import 就会 `import messageDac`
 * → `daos/core/schema/index.js` 顶层 await 连 MongoDB。结果是**四个前端依赖的契约面从来没有一条测试**
 * （我只能在 `docs/api/chat-sse.md` 里用文字描述它长什么样）。这与 `recoverCandidate` 那次是同一种结构病：
 * 判据写在"必须连库才 import 得动"的文件里，测试进不去，于是"验证"只能靠读源码文本或靠现网偶然发现。
 * ⇒ 纯函数搬到这里，`message.js` 原样转发导出，调用方（`memory/api.js`、探针、路由）一行都不用改。
 *
 * 搬动时顺手改掉的一处：`toolCalls` 在原实现里**写了两遍**（后者覆盖前者、值相同所以没暴露）。
 * 这种瑕疵不是运气问题，而是"这个函数从没被测过"的直接证据——所以本文件的用例里有一条专门数重复键。
 *
 * 安全边界（这里刻意**不**给的字段，都有明确理由，不是漏给）：
 * - `extInfo.messages`（发给模型的完整提示词）、工具返回原文：只在本机档案里，不外泄；
 * - `extInfo.writtenBy` / `extInfo.recoveredBy`：归档侧的归因审计字段。
 *   注意"`/core/message/list` 里读不到 `writtenBy`"**不等于**"这条档案没有来源标记"——
 *   把前者当成后者会得出完全相反的诊断结论（§25 记着这个陷阱）。
 */

/**
 * @description 把执行过程压缩成可展示的统计，不外泄工具原文与提示词
 * @param {Object} [extInfo] message 文档的执行过程字段
 * @returns {Object} 前端 ProcessPanel 用的摘要
 */
export function toProcessSummary(extInfo) {
    /** 空值一律归一成 `{}`：这是对外导出的纯函数，`null` 不该让它炸（default 参数接不住 null） */
    const info = extInfo || {}
    const skills = info.skills || {}
    return {
        iterationCount: info.iterationCount || 1,
        tools: (info.tools || []).map(t => t?.function?.name).filter(Boolean),
        toolCalls: info.toolCalls || [],
        toolChoice: info.toolChoice,
        answerRounds: (info.answerList || []).length,
        skills: {
            candidates: skills.candidates || [],
            loadedDetails: skills.loadedDetails || [],
            toolCount: skills.toolCount || 0,
            matchedCount: skills.matchedCount || 0,
        },
        contextUsage: info.contextUsage || null,
        sources: info.sources || [],
        recallStats: info.recallStats || null,
        /** 循环怎么退出的（break/exhausted/…）与是否补过无工具收尾调用；历史回放与探针都靠它解释空答案 */
        loopExit: info.loopExit || null,
        forcedFinal: !!info.forcedFinal,
        /**
         * 中断归因与"丢了多少字"——前端唯一能据此说真话的两个字段。
         *
         * 为什么要摊进视图（dev 实测 2026-11-11）：最近 54 条 `progress:"abort"` 里有 15 条 `answer` 为空，
         * 其中 **9 条是遗弃回填行**、3 条有段可回放、
         * 3 条确实首 token 前就断了。前端拿不到这两个字段时，那 12 条只能显示成一条空白气泡——
         * 用户看到的不是"没内容"，而是"什么都不告诉我"。
         *
         * **但 `lostChars` 现在不能当"损失量级"用**：回填行本来无从知道丢了什么，它原先被写成 `0`
         * （还配一句"留量级而不是留正文"的注释，注释承诺的字段代码并没有给），2026-11-11 起改判为 `null`
         * （见 `session/abandonedBackfill.js`）。所以前端的规则只能是 **`lostChars > 0` 才引用字数**；
         * `0`（历史存量）与 `null`（新写入）都表示"不知道"。
         *
         * 为什么**不**顺带给 `writtenBy`/`recoveredBy`：见文件头的边界说明。
         * 这里要的是"解释这一轮为什么空"，不是"这行是谁写的"，两件事别混成一个更大的暴露面。
         */
        interruptedBy: info.interruptedBy || null,
        /** 只认有限数字：缺失或非数值一律 null，不许用 0 冒充"丢了 0 字" */
        lostChars: Number.isFinite(info.lostChars) ? info.lostChars : null,
        /**
         * PR-B：过程分段。视图只裁不筛——段数与字段都原样给前端，
         * 让"这一轮模型做了什么"在历史回放里可见，而不是只有一句最终答案。
         */
        segments: info.segments || [],
        segmentSummary: info.segmentSummary || null,
        /** §14/G-6：本 run 的用量与调用次数（历史页与告警都读它） */
        usage: info.usage || null,
        /**
         * 被裁掉的工具结果的**量级摘要**（PR-H H3）。
         *
         * 为什么现在要给：`toolCalls[].result` 只是预览（预算 `limits.toolResultTraceChars`），
         * 全文在 `extInfo.toolOverflows` 里。此前视图两件事都不说，于是前端只能说"这是结果"，
         * 说不出"这条结果共 12,992 字、这里只有前 4000 字、全文服务端留存了"。
         * 实测这批 800 行：27 条留档、合计 209,939 字符、`stored:false` 0 条。
         *
         * **刻意不给 `content`**：本文件头写的外泄边界（工具返回原文只在服务端）不因这个字段松动——
         * 这里只有长度、工具名、留没留住，以及模型侧当时的裁剪量。
         * 前端要展示全文需要按 `ref` 单取的只读路由（H3 的第二半，尚未动工）。
         */
        toolResults: (info.toolOverflows || []).map(o => ({
            ref: o?.ref ?? o?.tool_call_id ?? null,
            tool: o?.tool || null,
            /** 原文真实字符数（留档前的长度） */
            chars: Number.isFinite(o?.chars) ? o.chars : null,
            /**
             * 全文是否真的留住了：`false` = 超出 `limits.overflowStoreChars`，尾部任何地方都取不回来。
             * 做成三态而不是"缺省算留住"：`stored` 这个键是留档机制一起加的，老行里可能根本没有它，
             * 而"没有这个键"意味着**不知道**——把它当成 true 就是拿猜测填事实位
             * （与 `lostChars`、`args` 那两条同一口径）。
             */
            stored: typeof o?.stored === 'boolean' ? o.stored : null,
            originalTokens: Number.isFinite(o?.originalTokens) ? o.originalTokens : null,
            keptTokens: Number.isFinite(o?.keptTokens) ? o.keptTokens : null,
        })),
    }
}

/**
 * @description 面向调用方的消息视图，剔除发给模型的完整提示词
 * @param {Object} doc message 文档
 * @returns {Object|null} 可安全外发的消息对象
 */
export function toMessageView(doc) {
    if (!doc) {
        return null
    }
    const extInfo = doc.extInfo || {}
    return {
        messageCode: doc.messageCode,
        conversationCode: doc.conversationCode,
        channel: doc.channel,
        channelGroup: doc.channelGroup,
        llmModel: doc.llmModel,
        query: doc.query,
        inputs: doc.inputs || [],
        answer: doc.answer,
        answerReasoning: doc.answerReasoning,
        answerFeedback: doc.answerFeedback,
        answerFromCache: !!doc.answerFromCache,
        answerCacheCode: doc.answerCacheCode,
        progress: doc.progress,
        error: doc.error,
        attachments: doc.attachments || [],
        answerAttachments: doc.answerAttachments || [],
        messageTokens: doc.messageTokens,
        answerTokens: doc.answerTokens,
        tokenizerVersion: doc.tokenizerVersion,
        insertTime: doc.insertTime,
        updateTime: doc.updateTime,
        process: toProcessSummary(extInfo),
    }
}

export default {toMessageView, toProcessSummary}
