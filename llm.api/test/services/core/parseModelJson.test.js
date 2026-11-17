import {test, describe} from 'node:test'
import * as assert from 'node:assert'

/**
 * `parseModelJson`：大模型回复的 JSON 抽取容错（与源仓同一改动）。
 *
 * 起因是现网读数（2026-11-17）：图片翻译接口对能正常识别的图返回「未识别」——
 * 上游 qwen-vl 把结果包进 ```json 围栏，trans.js 裸 JSON.parse 抛错被 catch 成「未识别」。
 * 这条用例锁住三级容错：直接 JSON → 剥围栏 → 截取最外层花括号。
 */
globalThis.llm = globalThis.llm || {
    tools: {},
    logger: {warn() {}, error() {}},
    config: {models: {}},
}
const {parseModelJson} = await import('../../../services/core/trans.js')

describe('parseModelJson', () => {
    test('纯 JSON 直接解析', () => {
        assert.deepStrictEqual(parseModelJson('{"ocr":"a","trans":"b"}'), {ocr: 'a', trans: 'b'})
    })

    test('```json 围栏包裹（现网实报形态）', () => {
        const t = '```json\n{\n  "ocr": "Agora",\n  "trans": "现在"\n}\n```'
        assert.deepStrictEqual(parseModelJson(t), {ocr: 'Agora', trans: '现在'})
    })

    test('无语言标注的 ``` 围栏', () => {
        assert.deepStrictEqual(parseModelJson('```\n{"fullTrans":"x","sentenceTrans":[]}\n```'), {fullTrans: 'x', sentenceTrans: []})
    })

    test('围栏外加解释文字仍抽出最外层对象', () => {
        const t = '好的，结果如下：\n```json\n{"ocr":"hello","trans":"你好"}\n```\n希望有帮助'
        assert.deepStrictEqual(parseModelJson(t), {ocr: 'hello', trans: '你好'})
    })

    test('无围栏但夹带前后缀解释文字', () => {
        const t = '识别结果：{"ocr":"x"} 以上'
        assert.deepStrictEqual(parseModelJson(t), {ocr: 'x'})
    })

    test('非法输入返回 null 不抛错', () => {
        assert.strictEqual(parseModelJson(''), null)
        assert.strictEqual(parseModelJson(null), null)
        assert.strictEqual(parseModelJson('无法识别与翻译。'), null)
        assert.strictEqual(parseModelJson('{坏掉的 json'), null)
    })
})
