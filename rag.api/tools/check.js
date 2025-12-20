/**
 * @fileOverview 字段合规性校验
 * @author xianyang 2025/3/26
 * @module
 */

/**
 * @description 校验通用标识字段的合法性
 * @author menglb
 * @param {String} fieldValue 标识字段的值
 * @param {String} fieldName 标识字段名称
 * @returns {Boolean} 校验是否通过
 */
export function checkCodeField(fieldValue, fieldName = '字段') {
    if (fieldValue) {
        if (!/^[0-9a-z-_]{3,64}$/g.test(fieldValue)) {
            throw new Error(`${fieldName}只能由小写字母、-、下划线和数字组成，至少3个字符，总长度不能超过64个字符`)
        }
    }
    return true
}