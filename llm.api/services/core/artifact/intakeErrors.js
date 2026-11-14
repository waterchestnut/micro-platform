/**
 * @fileOverview intake 稳定错误码（测试与变异按码匹配，不按文案——文案可改，码不可漂移）
 * @module services/core/artifact/intakeErrors
 * @description
 * 编排/转投各失败点给一个**可机读的码前缀**，接进 artifact 的 failed/补偿路径后，对账与排查看码定位，
 * 不必 grep 中文句子。新增码只增不改（改现有码=破坏历史账本的可读性）。
 */
export const INTAKE_ERRORS = {
    /** doc.api 传输/信封/尺寸类失败（HTTP 非 2xx、非 JSON、code≠0、请求异常、缓冲不符） */
    DOC_API_FAILED: 'DOC_API_FAILED',
    /** doc.api 上传成功却没回 fileCode（外部对象存在但没把手，不可知） */
    DOC_API_NO_FILECODE: 'DOC_API_NO_FILECODE',
    /** doc.api 回显 fileSize 与实发字节不符（疑似截断） */
    DOC_API_SIZE_MISMATCH: 'DOC_API_SIZE_MISMATCH',
    /** 转投前未配置 doc.api 基地址（接线问题） */
    DOC_API_NO_BASE: 'DOC_API_NO_BASE',
    /** 转投前未分配 fileCode（重试/对账将无从关联） */
    DOC_API_NO_ALLOC_CODE: 'DOC_API_NO_ALLOC_CODE',
    /** 模型面工具的执行依赖没接上（纯件先于接线存在时的如实回答） */
    TOOL_WIRING_NOT_READY: 'TOOL_WIRING_NOT_READY',
}

export default {INTAKE_ERRORS}
