/**
 * @fileOverview execd 文件分段的纯契约（PR-H2 intake 的前置判据，零依赖、离线可穷举测）
 * @module services/core/artifact/execdRange
 * @description
 * PR-H2 的 intake 要把沙箱产物从 execd `/files/download` 拉回来，大文件必须按 Range 分段流式取。
 * `openSandbox.call` 只回文本/JSON、拿不到原始字节与 `Content-Range`，所以分段语义不能靠它顺手做。
 * 而分段最容易错的四件事——off-by-one、把 `Content-Range: bytes 6-11/18` 的总长读错、
 * 越界 416 当成普通失败、分段计划漏尾/重叠——都发生在**纯逻辑**层，不发生在网络层，
 * 所以本模块只放**可离线证明对错**的部分；网络那半（client 方法/intake/落库）留到能连真实沙箱的窗口再落，
 * 不在没法验的时候写成"已完成"（本档反复守的边界）。
 *
 * 契约来源（不是猜的）：
 * - §0.1 v1.5 实测：`Range: bytes=6-11 → 206 + Content-Range: bytes 6-11/18 + 精确 6 字节`；
 *   `Range: bytes=0-1048575 → 206 + 精确 1048576`；intake 走 lifecycle 代理 `{base}/v1/sandboxes/{id}/proxy/{port}/files/...`（网关直连刚建箱 502）。
 * - Range 语义是 HTTP 标准（`bytes=start-end` 闭区间），416 = 请求区间不可满足（通常 start≥total）。
 */

/** 分段结果类别：intake 按这个决定"继续取下一段 / 停 / 报错 / 换路径" */
export const FILE_RESPONSE_KIND = {
    FULL: 'full',                       // 200，整文件在手里
    PARTIAL: 'partial',                 // 206，Range 段，按 total 决定是否还有后续
    EMPTY: 'empty',                     // 200/206 但 0 字节（空文件）
    NOT_FOUND: 'not-found',             // 404，产物不存在（孤儿对账会用到这个事实）
    RANGE_UNSATISFIABLE: 'range-unsatisfiable', // 416，偏移已越过 EOF ⇒ 应停止，而不是当错误重试
    ERROR: 'error',                     // 其它，真异常
}

/**
 * @description 造闭区间 Range 头（intake 只用明确 start-end，不用 suffix/open 形式，语义最简单可控）
 * @param {Number} start 起始字节（含）
 * @param {Number} end 结束字节（含）
 * @returns {String} `bytes=start-end`
 */
export function buildRangeHeader(start, end) {
    const s = Number(start)
    const e = Number(end)
    if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e < s) {
        throw new Error(`非法 Range 区间：start=${start} end=${end}（需 0≤start≤end 的整数）`)
    }
    return `bytes=${s}-${e}`
}

/**
 * @description 解析 `Content-Range` 响应头（只支持 bytes 单元，execd/HTTP 标准即如此）
 * @param {String} header 形如 `bytes 6-11/18`（也接受 `bytes=6-11/18` 这种不规范写法）
 * @returns {{unit:String,start:Number,end:Number,total:Number|null}|null} 解析结果，非法格式返回 null
 *
 * total 为 `*` 时记 null（服务端没给总长），intake 必须据此**不敢**按"取到=拿全"来收尾。
 */
export function parseContentRange(header) {
    const s = String(header || '').trim()
    if (!s) return null
    const m = /^bytes\s*[= ]\s*(\d+)-(\d+)\/(\d+|\*)$/i.exec(s)
    if (!m) return null
    return {
        unit: 'bytes',
        start: Number(m[1]),
        end: Number(m[2]),
        total: m[3] === '*' ? null : Number(m[3]),
    }
}

/**
 * @description 把一次 execd 文件响应解读成分段决策所需的事实（纯函数，编码 §0.1 实测契约）
 * @param {Object} p
 * @param {Number} p.status HTTP 状态码
 * @param {String} [p.contentRange] `Content-Range` 头原文
 * @param {Number} p.receivedBytes 实际收到的字节数
 * @param {Object} [p.requested] 本次请求的 {start,end}（有 Range 时传入，用于核对服务端给的对不对）
 * @returns {{kind:String,total:Number|null,start:Number|null,end:Number|null,complete:Boolean,reason:String,bytesMismatch:Boolean}} 结果
 *
 * 关键判定：
 * - 200 且无 Content-Range ⇒ 整文件在手里，total=receivedBytes，complete=true；0 字节 ⇒ EMPTY。
 * - 206 ⇒ 段；从 Content-Range 取 total 与区间；`receivedBytes` 必须等于 `end-start+1`，
 *   否则 **bytesMismatch=true**（服务端多给/少给，intake 不能假装正常——这正是要显式暴露的错）。
 *   `complete = (end+1 >= total)`：拿到最后一段才算取全；total 为 null（`*`）时**不敢**判 complete。
 * - 416 ⇒ RANGE_UNSATISFIABLE：偏移越过 EOF，intake 应停止（不是重试）。
 * - 404 ⇒ NOT_FOUND。
 * - 其余 ⇒ ERROR。
 */
export function interpretFileResponse({status, contentRange, receivedBytes, requested = null} = {}) {
    const st = Number(status)
    const got = Number(receivedBytes) || 0
    const cr = parseContentRange(contentRange)

    if (st === 404) {
        return {kind: FILE_RESPONSE_KIND.NOT_FOUND, total: null, start: null, end: null, complete: false, reason: 'not-found', bytesMismatch: false}
    }
    if (st === 416) {
        return {kind: FILE_RESPONSE_KIND.RANGE_UNSATISFIABLE, total: cr?.total ?? null, start: null, end: null, complete: false, reason: 'range-past-eof', bytesMismatch: false}
    }
    if (st === 206) {
        if (!cr) {
            // 206 却没有可解析的 Content-Range：不可信，交给上层当错误处理，别默认"成功"
            return {kind: FILE_RESPONSE_KIND.ERROR, total: null, start: null, end: null, complete: false, reason: '206-without-parseable-content-range', bytesMismatch: false}
        }
        const span = cr.end - cr.start + 1
        const bytesMismatch = got !== span
        // 与请求区间不符也标出来（服务端可能忽略了 Range 直接回全文 → 长度对得上但区间是 0..total-1）
        const rangeMismatch = requested && Number.isInteger(requested.start)
            && (cr.start !== requested.start || cr.end !== requested.end)
        const complete = cr.total == null ? false : (cr.end + 1 >= cr.total)
        return {
            kind: got === 0 ? FILE_RESPONSE_KIND.EMPTY : FILE_RESPONSE_KIND.PARTIAL,
            total: cr.total, start: cr.start, end: cr.end, complete,
            reason: rangeMismatch ? 'partial-range-not-as-requested' : (bytesMismatch ? 'partial-byte-count-mismatch' : 'partial'),
            bytesMismatch: bytesMismatch || !!rangeMismatch,
        }
    }
    if (st === 200) {
        if (cr) {
            // 200 却带 Content-Range：异常混合，保守当 mismatch，不默认成功
            return {kind: FILE_RESPONSE_KIND.ERROR, total: cr.total, start: cr.start, end: cr.end, complete: false, reason: '200-with-content-range', bytesMismatch: true}
        }
        return {
            kind: got === 0 ? FILE_RESPONSE_KIND.EMPTY : FILE_RESPONSE_KIND.FULL,
            total: got, start: got ? 0 : null, end: got ? got - 1 : null, complete: true,
            reason: got === 0 ? 'empty' : 'full', bytesMismatch: false,
        }
    }
    return {kind: FILE_RESPONSE_KIND.ERROR, total: null, start: null, end: null, complete: false, reason: `unexpected-status-${st}`, bytesMismatch: false}
}

/**
 * @description 把"总长 total 的文件按每段最多 maxBytes 分段"排成覆盖 [0,total) 的闭区间计划
 * @param {Number} total 文件总字节数
 * @param {Number} maxBytes 单段上限（>0）
 * @returns {{start:Number,end:Number,index:Number}[]} 从 0 开始、无重叠、必达 total（尾段自然变短）
 *
 * 刻意做成纯函数并穷举测：分段计划的漏尾/重叠/off-by-one 会让 intake 悄悄丢一段产物或取越界 416，
 * 而这类 bug 在真实大文件上很难靠肉眼发现（§0.1 特意量了 5MB→1MB 段精确 1048576 就是为了钉这种边界）。
 * total<=0 ⇒ 空计划（空文件不是一段 range 能表达的，交给 FULL/EMPTY 判定走整取）。
 */
export function planRangeSlices(total, maxBytes) {
    const t = Number(total)
    const m = Number(maxBytes)
    if (!Number.isInteger(t) || t <= 0 || !Number.isInteger(m) || m <= 0) {
        return []
    }
    const slices = []
    let start = 0
    let index = 0
    while (start < t) {
        const end = Math.min(start + m - 1, t - 1)
        slices.push({start, end, index: index++})
        start = end + 1
    }
    return slices
}

export default {FILE_RESPONSE_KIND, buildRangeHeader, parseContentRange, interpretFileResponse, planRangeSlices}
