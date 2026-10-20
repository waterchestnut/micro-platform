/**
 * @fileOverview 评测用的向量嵌入客户端
 * @module evals/memory/embed
 * @description 语义召回这一路需要真实向量，否则比出来的分数是自欺欺人。
 * 这里只服务评测，不进生产链路：生产侧的向量写入属于 PR-12（rag.api Milvus + ES），
 * 其形态、鉴权与配额尚有 Q3/Q4 未定，先在评测里把"语义 vs 词法"的差距量出来，
 * 才能判断 PR-12 值不值得做。
 *
 * 默认打局域网嵌入中转（实测 192.168.31.127:9997 可直连 bge-m3，1024 维；
 * 3009 端口对 bge-m3 返回 401，需要另一把 key，故不作默认值）。
 * 拿不到嵌入服务时**明确返回不可用**，由调用方把该路标记为 SKIPPED，绝不伪造数字。
 */

const cache = new Map()

/**
 * @description 读取嵌入服务配置
 * @author xianyang
 * @returns {Object|null} 配置，缺 baseURL 时返回 null
 */
export function embeddingConfig() {
    const baseURL = process.env.eval_embedding_baseURL || 'http://192.168.31.127:9997/v1'
    if (!baseURL) {
        return null
    }
    return {
        baseURL,
        apiKey: process.env.eval_embedding_apiKey || 'not-needed',
        model: process.env.eval_embedding_model || 'bge-m3',
        dimensions: parseInt(process.env.eval_embedding_dimensions || '1024'),
        timeoutMs: parseInt(process.env.eval_embedding_timeoutMs || '20000'),
    }
}

/**
 * @description 批量取向量，带进程内缓存
 * @author xianyang
 * @param {String[]} texts 文本
 * @returns {Promise<Array|null>} 向量数组，不可用或失败时返回 null
 */
export async function embedTexts(texts) {
    const cfg = embeddingConfig()
    if (!cfg || !texts?.length) {
        return null
    }
    const out = []
    const todo = []
    const todoIdx = []
    texts.forEach((t, i) => {
        const key = `${cfg.model}|${t}`
        if (cache.has(key)) {
            out[i] = cache.get(key)
        } else {
            todo.push(t)
            todoIdx.push(i)
        }
    })
    if (todo.length) {
        try {
            const res = await fetch(`${cfg.baseURL}/embeddings`, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    authorization: `Bearer ${cfg.apiKey}`,
                },
                body: JSON.stringify({
                    model: cfg.model,
                    input: todo,
                    encoding_format: 'float',
                }),
                signal: AbortSignal.timeout(cfg.timeoutMs),
            })
            if (!res.ok) {
                return null
            }
            const json = await res.json()
            const sorted = [...(json.data || [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
            sorted.forEach((d, k) => {
                const vec = d.embedding
                if (!Array.isArray(vec) || !vec.length) {
                    return
                }
                cache.set(`${cfg.model}|${todo[k]}`, vec)
                out[todoIdx[k]] = vec
            })
        } catch (e) {
            console.log(`  嵌入服务不可用: ${e.message}`)
            return null
        }
    }
    return out.every(_ => Array.isArray(_)) ? out : null
}

/**
 * @description 余弦相似度
 * @author xianyang
 * @param {Number[]} a 向量一
 * @param {Number[]} b 向量二
 * @returns {Number} 相似度
 */
export function cosine(a, b) {
    let dot = 0
    let na = 0
    let nb = 0
    const len = Math.min(a.length, b.length)
    for (let i = 0; i < len; i++) {
        dot += a[i] * b[i]
        na += a[i] * a[i]
        nb += b[i] * b[i]
    }
    if (!na || !nb) {
        return 0
    }
    return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/**
 * @description 探测嵌入服务是否可用
 * @author xianyang
 * @returns {Promise<Boolean>} 是否可用
 */
export async function embeddingAvailable() {
    const vec = await embedTexts(['连通性探测'])
    return Boolean(vec?.length)
}

export default {embedTexts, cosine, embeddingConfig, embeddingAvailable}
