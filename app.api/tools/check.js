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
        if (!/^[a-z][0-9a-z-]{2,31}$/g.test(fieldValue)) {
            throw new Error(`${fieldName}只能由小写字母、-和数字组成，至少3个字符，且第一个字符必须为字母，总长度不能超过32个字符`)
        }
    }
    return true
}