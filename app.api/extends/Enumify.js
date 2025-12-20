/**
 * @fileOverview 模拟枚举类型的基础类
 * @author xianyang 2024/5/28
 * @module
 */

export default class Enumify {
    static enumList
    static valueEnum
    static descriptionEnum

    static closeEnum() {
        const enumList = []
        const valueEnum = {}
        const descriptionEnum = {}
        for (const [key, entity] of Object.entries(this)) {
            entity.key = key
            entity.value = typeof entity.value === "undefined" ? enumList.length : entity.value
            enumList.push(entity)
            valueEnum[entity.value] = entity.description
            descriptionEnum[entity.description] = entity.value
        }
        this.enumList = enumList
        this.valueEnum = valueEnum
        this.descriptionEnum = descriptionEnum
        return enumList
    }

    static toDescription(val) {
        return this.valueEnum[val]
    }

    static toValue(des) {
        return this.descriptionEnum[des]
    }

    static toDescriptions() {
        return this.enumList.map((entity) => entity.description)
    }

    static toValues() {
        return this.enumList.map((entity) => entity.value)
    }

    static [Symbol.iterator]() {
        return this.enumList[Symbol.iterator]()
    }

    key
    value
    description

    constructor(val, des) {
        this.value = val
        this.description = des
    }

    toString() {
        return this.constructor.name + '.' + this.key
    }
}