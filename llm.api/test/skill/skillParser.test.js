/**
 * @fileOverview skillParser 命令参数解析的回归哨
 * @module test/skill/skillParser
 * @description
 * 锁 parseCommandParameters 对可选标记 `?` 的处理：`title?:string` 的属性名必须是 `title`
 * （不能带 `?`）且非必填；无 `?` 者必填。此前不剥 `?` ⇒ 模型照发 "title?" 键、写面 handler
 * 取不到参数（feature-map §4B createDraft 实锤暴露）。
 */
import {describe, test} from 'node:test'
import assert from 'node:assert/strict'

globalThis.llm = globalThis.llm || {logger: console, config: {}}
const {SkillParser} = await import('../../skill/skillParser.js')
const parser = new SkillParser()

describe('parseCommandParameters 可选标记 ?', () => {
    test('`title?:string` ⇒ 属性名 title（剥 ?）且非必填', () => {
        const s = parser.parseCommandParameters('title?:string, content?:string')
        assert.ok(s.properties.title && !('title?' in s.properties), '属性名不应带 ?')
        assert.equal(s.properties.title.type, 'string')
        assert.ok(!s.required.includes('title'), '可选参数不该进 required')
        assert.ok(!s.required.includes('content'))
    })
    test('无 `?` ⇒ 必填', () => {
        const s = parser.parseCommandParameters('researchCode:string')
        assert.ok(s.properties.researchCode)
        assert.deepEqual(s.required, ['researchCode'])
    })
    test('混合：必填与可选各归其位', () => {
        const s = parser.parseCommandParameters('pageIndex?:number, pageSize?:number, title?:string')
        assert.deepEqual(Object.keys(s.properties).sort(), ['pageIndex', 'pageSize', 'title'])
        assert.deepEqual(s.required, [], '全 ? ⇒ 全可选')
    })
    test('类型归一小写', () => {
        const s = parser.parseCommandParameters('n?:Number')
        assert.equal(s.properties.n.type, 'number')
    })
    test('空串 ⇒ 空 schema', () => {
        assert.deepEqual(parser.parseCommandParameters(''), {type: 'object', properties: {}, required: []})
    })
})
